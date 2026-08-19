import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Add account" is the half of multi-account switching that touches the live
 * session, so it is the half that can do real damage. Two properties matter,
 * and neither is visible in the UI when it breaks:
 *
 *  1. **Abandoning the flow must cost nothing.** Someone who opens "Add
 *     account", gets as far as the code screen and closes the tab must still be
 *     signed in as the account they started from. That holds because nothing is
 *     written until `verifyOtp` actually succeeds — and because the "no free
 *     slot" refusal happens BEFORE the code is spent, not after the session has
 *     already been replaced.
 *
 *  2. **An ordinary sign-in must NOT quietly keep the previous session alive.**
 *     Signing in as someone else on a shared computer has always replaced the
 *     session; keeping the old one reachable from a switcher would be a
 *     regression dressed as a feature. So the stash only ever happens on the
 *     explicit add path.
 */

type Session = { access_token: string; refresh_token: string; user: { id: string } } | null;

let session: Session = null;
let verifyResult: { data: { user: { id: string } | null }; error: unknown } = {
  data: { user: { id: "user-new" } },
  error: null,
};
let freeSlot: number | null = 0;
const verifyOtp = vi.fn(async () => verifyResult);
const stashed: { slot: number; userId: string }[] = [];

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  // The real one throws NEXT_REDIRECT, and the code after it must not run.
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("./rate-limit", () => ({
  checkRateLimit: async () => ({ ok: true }),
  getClientIp: async () => "127.0.0.1",
}));
vi.mock("./site-url", () => ({ trustedOriginFor: () => "https://kivo.test" }));
vi.mock("./auth", () => ({
  isAuthConfigured: () => true,
  sanitizeRedirectPath: (value?: string) => (value?.startsWith("/") ? value : undefined),
}));
vi.mock("./profile", () => ({
  resolveViewerProfile: async () => ({ status: "ready", profile: { onboarding_completed: true } }),
}));
vi.mock("./supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      verifyOtp,
    },
  }),
}));
vi.mock("./supabase/stored-accounts", () => ({
  MAX_STORED_ACCOUNTS: 3,
  findFreeSlot: async () => freeSlot,
  stashSessionInSlot: async (slot: number, tokens: { userId: string }) => {
    stashed.push({ slot, userId: tokens.userId });
    return { error: null };
  },
}));

const { verifyEmailCode } = await import("./auth-actions");

/** The action redirects on success, which throws. Turn that back into a value
 *  so a test can assert on where it went. */
async function verify(code: string, addAccount?: boolean) {
  try {
    const failure = await verifyEmailCode("new@kivo.test", code, undefined, addAccount);
    return { failure, redirectedTo: null as string | null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return { failure: undefined, redirectedTo: message.slice(9) };
    throw error;
  }
}

beforeEach(() => {
  session = { access_token: "access-a", refresh_token: "refresh-a", user: { id: "user-a" } };
  verifyResult = { data: { user: { id: "user-new" } }, error: null };
  freeSlot = 0;
  verifyOtp.mockClear();
  stashed.length = 0;
});

describe("verifyEmailCode, adding an account", () => {
  it("keeps the account being replaced, so the switcher can get back to it", async () => {
    const { redirectedTo } = await verify("123456", true);

    expect(redirectedTo).toBe("/home");
    expect(stashed).toEqual([{ slot: 0, userId: "user-a" }]);
  });

  it("refuses BEFORE spending the code when there is nowhere to keep the current account", async () => {
    freeSlot = null;

    const { failure } = await verify("123456", true);

    expect(failure?.error).toMatch(/sign one out/i);
    // The decisive assertion: the code was never verified, so the session was
    // never replaced and the user is still signed in as who they were.
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(stashed).toEqual([]);
  });

  it("does not store a second copy of the account you were already using", async () => {
    verifyResult = { data: { user: { id: "user-a" } }, error: null };

    await verify("123456", true);

    expect(stashed).toEqual([]);
  });

  it("has nothing to keep when nobody was signed in", async () => {
    session = null;

    const { redirectedTo } = await verify("123456", true);

    expect(redirectedTo).toBe("/home");
    expect(stashed).toEqual([]);
  });
});

describe("verifyEmailCode, ordinary sign-in", () => {
  it("still replaces a session left behind on a shared device rather than keeping it switchable", async () => {
    const { redirectedTo } = await verify("123456");

    expect(redirectedTo).toBe("/home");
    expect(stashed).toEqual([]);
  });

  it("keeps the current account when the code is wrong", async () => {
    verifyResult = { data: { user: null }, error: { code: "otp_expired", message: "expired" } };

    const { failure } = await verify("123456", true);

    expect(failure?.error).toMatch(/expired/i);
    expect(stashed).toEqual([]);
  });
});
