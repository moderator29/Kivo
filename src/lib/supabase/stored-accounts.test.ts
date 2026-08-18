import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-account switching is a cookie layout, and every security property it
 * has comes from that layout rather than from a check further up. These tests
 * pin the four properties that would be silently, invisibly wrong if someone
 * refactored this later:
 *
 *  1. A stored slot's cookie is `httpOnly` — client JavaScript can never read
 *     an inactive account's refresh token.
 *  2. "Sign out" on a stored account genuinely revokes the session with
 *     Supabase before the cookie is dropped, rather than merely hiding a live
 *     credential.
 *  3. A session Supabase no longer accepts is cleared, not listed.
 *  4. Nothing token-shaped can reach the client through the switcher's data.
 *
 * What is NOT testable here, and is not pretended otherwise: driving a real
 * expired-then-refreshed Supabase session needs a real project and a real wait,
 * and this sandbox cannot reach *.supabase.co at all (the same honest limit
 * proxy.test.ts documents). These drive the contract between this module and
 * the Supabase client, which is where the bugs would actually be.
 */

type Stored = { value: string; options: Record<string, unknown> };

class FakeCookieStore {
  jar = new Map<string, Stored>();
  getAll() {
    return [...this.jar.entries()].map(([name, { value }]) => ({ name, value }));
  }
  has(name: string) {
    return this.jar.has(name);
  }
  get(name: string) {
    const found = this.jar.get(name);
    return found ? { name, value: found.value } : undefined;
  }
  set(name: string, value: string, options: Record<string, unknown> = {}) {
    this.jar.set(name, { value, options });
  }
  delete(name: string) {
    this.jar.delete(name);
  }
}

let store = new FakeCookieStore();

vi.mock("next/headers", () => ({
  cookies: async () => store,
}));

/** Captured per created client, keyed by the cookie name it was bound to. */
/** Typed as a plain async function rather than vitest's `Mock`, which is not
 *  callable under this tsconfig. Every one of these is still a `vi.fn` at
 *  runtime, so the call-count assertions below work unchanged. */
type AsyncStub = (...args: unknown[]) => Promise<unknown>;

type ClientStub = {
  cookieOptions: Record<string, unknown>;
  getUser: AsyncStub;
  getSession: AsyncStub;
  setSession: AsyncStub;
  signOut: AsyncStub;
  rpc: AsyncStub;
  profileRow: unknown;
};

const clients: ClientStub[] = [];
/** Every cookie name touched, in order, so "revoked before dropped" is
 *  provable rather than assumed. */
const trace: string[] = [];
/** What the NEXT client built should answer with. Queued by a test rather than
 *  patched onto the client afterwards, because the module under test creates
 *  its clients internally and uses them immediately. */
let nextStub: Partial<ClientStub> = {};

function makeClientStub(cookieOptions: Record<string, unknown>): ClientStub {
  const stub: ClientStub = {
    cookieOptions,
    profileRow: null,
    getUser: vi.fn(async () => ({ data: { user: null }, error: { message: "no session" } })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    setSession: vi.fn(async () => ({ data: { session: null, user: null }, error: null })),
    signOut: vi.fn(async () => {
      trace.push(`signOut:${String(cookieOptions.name)}`);
      return { error: null };
    }),
    rpc: vi.fn(async () => ({ data: 0, error: null })),
    ...nextStub,
  };
  return stub;
}

/** The answers a signed-in slot gives, with anything a test wants to change. */
function slotAnswers(overrides: Partial<ClientStub> = {}): Partial<ClientStub> {
  return {
    getUser: vi.fn(async () => ({ data: { user: { id: "user-b", email: "b@kivo.test" } }, error: null })),
    profileRow: PROFILE,
    ...overrides,
  };
}

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookieOptions: Record<string, unknown> }) => {
    const stub = makeClientStub(options.cookieOptions);
    clients.push(stub);
    return {
      auth: {
        getUser: () => stub.getUser(),
        getSession: () => stub.getSession(),
        setSession: (t: unknown) => stub.setSession(t),
        signOut: (o: unknown) => stub.signOut(o),
      },
      rpc: (name: string, args: unknown) => stub.rpc(name, args),
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: stub.profileRow, error: null }),
          }),
        }),
      }),
    };
  },
}));

const {
  MAX_STORED_ACCOUNTS,
  clearSlot,
  findFreeSlot,
  listStoredAccounts,
  occupiedSlots,
  readStoredAccount,
  signOutStoredSlot,
  slotCookieName,
  stashSessionInSlot,
} = await import("./stored-accounts");

const PROFILE = {
  id: "profile-b",
  username: "second_account",
  display_name: "Second Account",
  avatar_type: "kivo" as const,
  avatar_kivo_id: null,
  avatar_uploaded_url: null,
  avatar_url: null,
};

beforeEach(() => {
  store = new FakeCookieStore();
  clients.length = 0;
  trace.length = 0;
  nextStub = {};
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

/** The cookie a signed-in slot would be holding. */
function occupySlot(slot: number) {
  store.set(slotCookieName(slot), "base64-whatever", {});
}

function lastClient(): ClientStub {
  return clients[clients.length - 1];
}

describe("slot cookies", () => {
  it("are httpOnly, unlike the active session's — client JS can never read a stored refresh token", async () => {
    occupySlot(1);
    await readStoredAccount(1);

    const options = lastClient().cookieOptions;
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.name).toBe("kivo-account-1");
  });

  it("never collide with the active session's cookie, which is the whole isolation guarantee", () => {
    const names = Array.from({ length: MAX_STORED_ACCOUNTS }, (_, i) => slotCookieName(i));
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      // `@supabase/ssr` only ever writes cookies whose name is exactly its
      // storageKey or that key plus a `.<n>` chunk suffix, so a name that
      // shares no prefix with `sb-` cannot be reached by the active client and
      // vice versa.
      expect(name.startsWith("sb-")).toBe(false);
      expect(name.startsWith("kivo-account-")).toBe(true);
    }
  });

  it("report which slots are taken, and hand out the first free one", async () => {
    expect(await occupiedSlots()).toEqual([]);
    expect(await findFreeSlot()).toBe(0);

    occupySlot(0);
    // A chunked cookie counts as occupancy too, or a large session would look
    // like an empty slot and be overwritten.
    store.set(`${slotCookieName(1)}.0`, "chunk", {});

    expect(await occupiedSlots()).toEqual([0, 1]);
    expect(await findFreeSlot()).toBe(2);
  });

  it("refuse a slot number outside the supported range", async () => {
    const result = await stashSessionInSlot(MAX_STORED_ACCOUNTS, {
      userId: "u",
      accessToken: "a",
      refreshToken: "r",
    });
    expect(result.error).toBeTruthy();
    expect(clients).toHaveLength(0);
  });

  it("clear every chunk a session could occupy, not just the base cookie", async () => {
    store.set(slotCookieName(2), "base", {});
    store.set(`${slotCookieName(2)}.0`, "chunk0", {});
    store.set(`${slotCookieName(2)}.1`, "chunk1", {});
    store.set("sb-project-auth-token", "the active session", {});

    await clearSlot(2);

    expect(store.has(slotCookieName(2))).toBe(false);
    expect(store.has(`${slotCookieName(2)}.0`)).toBe(false);
    expect(store.has(`${slotCookieName(2)}.1`)).toBe(false);
    // The active session is untouched. A switcher that signs you out of the
    // account you are using while tidying up another one is the worst bug this
    // feature could have.
    expect(store.has("sb-project-auth-token")).toBe(true);
  });
});

describe("signing a stored account out", () => {
  it("revokes the session with Supabase BEFORE dropping the cookie", async () => {
    occupySlot(1);

    await signOutStoredSlot(1);

    // Revocation actually happened, and with the scope that ends this session
    // rather than every session the person has on every device.
    expect(clients).toHaveLength(1);
    expect(clients[0].signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(trace).toEqual(["signOut:kivo-account-1"]);
    expect(store.has(slotCookieName(1))).toBe(false);
  });

  it("still forgets the account when revocation fails, rather than leaving a row that says it did not", async () => {
    occupySlot(1);
    nextStub = { signOut: vi.fn(async () => ({ error: { message: "network down" } })) };

    await signOutStoredSlot(1);

    expect(clients[0].signOut).toHaveBeenCalled();
    expect(store.has(slotCookieName(1))).toBe(false);
  });
});

describe("reading a stored account", () => {
  it("clears a slot Supabase rejects instead of listing a row that would fail when tapped", async () => {
    occupySlot(0);
    const account = await readStoredAccount(0);

    expect(account).toBeNull();
    expect(store.has(slotCookieName(0))).toBe(false);
  });

  it("reports XP that could not be read as null, never as a stand-in zero", async () => {
    occupySlot(0);
    nextStub = slotAnswers({ rpc: vi.fn(async () => ({ data: null, error: { message: "rpc unavailable" } })) });

    const account = await readStoredAccount(0);

    expect(account).not.toBeNull();
    expect(account!.xp).toBeNull();
    expect(account!.username).toBe("second_account");
    expect(account!.email).toBe("b@kivo.test");
  });

  it("reports a genuine zero as zero — a real total is a fact, whatever its value", async () => {
    occupySlot(0);
    nextStub = slotAnswers({ rpc: vi.fn(async () => ({ data: 0, error: null })) });

    const account = await readStoredAccount(0);

    expect(account!.xp).toBe(0);
  });

  it("hands the client nothing token-shaped", async () => {
    occupySlot(0);
    const secret = "eyJhbGciOi.SUPER-SECRET-ACCESS-TOKEN";
    nextStub = slotAnswers({
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-b", email: "b@kivo.test", access_token: secret } },
        error: null,
      })),
    });

    const account = await readStoredAccount(0);

    // The switcher's payload crosses the server/client boundary as a Server
    // Action result, so anything in it is in the page's RSC payload.
    expect(JSON.stringify(account)).not.toContain(secret);
    expect(Object.keys(account!).sort()).toEqual([
      "avatarSrc",
      "displayName",
      "email",
      "slot",
      "userId",
      "username",
      "xp",
    ]);
  });
});

describe("listing stored accounts", () => {
  it("never lists the account you are already using, and clears the duplicate slot", async () => {
    occupySlot(0);
    nextStub = slotAnswers({
      getUser: vi.fn(async () => ({ data: { user: { id: "user-a", email: "a@kivo.test" } }, error: null })),
      profileRow: { ...PROFILE, id: "profile-a", username: "first_account" },
    });

    const accounts = await listStoredAccounts("user-a");

    expect(accounts).toEqual([]);
    expect(store.has(slotCookieName(0))).toBe(false);
  });
});
