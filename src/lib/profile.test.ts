import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * KN-121/KN-122. `resolveViewerProfile()` is now the ONLY thing that provisions
 * a KIVO profile. Under Clerk a webhook created the row and this was a
 * fallback; under Supabase Auth there is no webhook, so a brand-new account's
 * profile is created here, inline, on its very first authenticated request.
 *
 * That makes its three outcomes load-bearing in a way nothing asserted:
 *
 *   anonymous   -> redirect to sign-in
 *   ready       -> render the app
 *   unavailable -> render a terminal error, NEVER redirect
 *
 * The third is the one with teeth. Collapsing `unavailable` into `anonymous` —
 * which is what a plain `Profile | null` return type forced — is what produced
 * the redirect loop: `(app)` sends the user to `/sign-in`, `/sign-in` sees a
 * perfectly valid session and sends them back, forever, until the browser gives
 * up with ERR_TOO_MANY_REDIRECTS. These tests pin the distinction so a future
 * refactor cannot quietly re-merge the two.
 */

vi.mock("server-only", () => ({}));

// This suite exercises pure resolution logic and must not need a Next.js
// request scope to do it. `next/headers` throws outright when called outside
// one ("`cookies` was called outside a request scope"), so any code path in
// profile.ts that reaches for it — now or later — would fail every test here
// for a reason that has nothing to do with what is being tested. Stubbed to an
// empty cookie jar: the default, uninteresting answer, which lets resolution
// run exactly as it does for a real signed-in request.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], has: () => false }),
  headers: async () => new Headers(),
}));

const getAuthUser = vi.fn();
vi.mock("./auth", () => ({ getAuthUser: () => getAuthUser() }));

const maybeSingle = vi.fn();
const insertSingle = vi.fn();
/** Every row profile.ts tried to insert, in order — so a test can assert on the
 *  identity actually written, not just on how many attempts were made. */
const inserted: Record<string, unknown>[] = [];
/** What `supabase.auth.getUser()` reports. This is where the name, handle and
 *  country a user typed on /sign-up arrive from, carried across verification as
 *  Supabase user metadata. */
let authUser: { user_metadata?: Record<string, unknown> } | null = null;

vi.mock("./supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: { getUser: async () => ({ data: { user: authUser }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return { select: () => ({ single: insertSingle }) };
      },
    }),
  }),
}));

vi.mock("./kivo-assets", () => ({ randomKivoAvatarId: () => "kivo-01" }));

const USER = { id: "11111111-1111-4111-8111-111111111111", email: "fan@example.invalid" };
const ROW = { id: "profile-1", auth_user_id: USER.id, username: "user_1111111111" };

async function load() {
  vi.resetModules();
  return import("./profile");
}

beforeEach(() => {
  getAuthUser.mockReset();
  maybeSingle.mockReset();
  insertSingle.mockReset();
  inserted.length = 0;
  authUser = { user_metadata: {} };
});

describe("resolveViewerProfile", () => {
  it("is `anonymous` when nobody is signed in — and never touches the database", async () => {
    getAuthUser.mockResolvedValue(null);
    const { resolveViewerProfile } = await load();
    expect(await resolveViewerProfile()).toEqual({ status: "anonymous" });
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it("is `ready` for an existing profile, without attempting an insert", async () => {
    getAuthUser.mockResolvedValue(USER);
    maybeSingle.mockResolvedValue({ data: ROW, error: null });
    const { resolveViewerProfile } = await load();
    expect(await resolveViewerProfile()).toEqual({ status: "ready", profile: ROW });
    expect(insertSingle).not.toHaveBeenCalled();
  });

  it("provisions the row on a brand-new account's first authenticated request", async () => {
    getAuthUser.mockResolvedValue(USER);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: ROW, error: null });
    const { resolveViewerProfile } = await load();
    expect(await resolveViewerProfile()).toEqual({ status: "ready", profile: ROW });
    expect(insertSingle).toHaveBeenCalledTimes(1);
  });

  // THE loop-prevention assertion: a signed-in user whose row cannot be created
  // must resolve to `unavailable`, which the layout renders as a terminal
  // screen. If this ever returns `anonymous` again, the app and /sign-in start
  // bouncing the user between them.
  it("is `unavailable` — NOT `anonymous` — when the insert fails for a real reason", async () => {
    getAuthUser.mockResolvedValue(USER);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: null, error: { code: "42501", message: "rls" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { resolveViewerProfile } = await load();
    const result = await resolveViewerProfile();
    expect(result).toEqual({ status: "unavailable" });
    expect(result.status).not.toBe("anonymous");
  });

  it("recovers from the two-tabs insert race (23505) by re-reading the winner's row", async () => {
    getAuthUser.mockResolvedValue(USER);
    // First read misses, insert loses the race, second read finds the row the
    // other request just committed.
    maybeSingle.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: ROW, error: null });
    insertSingle.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
    const { resolveViewerProfile } = await load();
    expect(await resolveViewerProfile()).toEqual({ status: "ready", profile: ROW });
  });

  it("is `unavailable` when even the post-race re-read comes back empty", async () => {
    getAuthUser.mockResolvedValue(USER);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
    const { resolveViewerProfile } = await load();
    expect(await resolveViewerProfile()).toEqual({ status: "unavailable" });
  });
});

describe("getOrCreateProfile", () => {
  // The convenience wrapper deliberately flattens all of this to `Profile |
  // null`, which is right for callers that only ask "is there a profile to act
  // as?" — but is exactly why anything DECIDING WHERE TO SEND SOMEONE must use
  // resolveViewerProfile instead. Pinned so the distinction stays deliberate.
  it("flattens both `anonymous` and `unavailable` to null", async () => {
    getAuthUser.mockResolvedValue(null);
    let mod = await load();
    expect(await mod.getOrCreateProfile()).toBeNull();

    getAuthUser.mockResolvedValue(USER);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: null, error: { code: "42501", message: "rls" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    mod = await load();
    expect(await mod.getOrCreateProfile()).toBeNull();
  });
});


/**
 * Provisioning from what the user typed on /sign-up.
 *
 * Since 2026-08-19 the handle, name and country are collected BEFORE
 * verification and travel to Supabase as user metadata; this function is where
 * they become a profile row. Two properties matter and neither is visible when
 * it breaks:
 *
 *  1. **Metadata is an input, not a fact.** Any signed-in user can write
 *     anything into `raw_user_meta_data` with `updateUser({ data })`, so every
 *     field is re-validated here and a bad one is dropped rather than repaired.
 *  2. **A lost handle must not become a lost account.** The handle is checked at
 *     sign-up but nothing reserves it, so somebody else can take it before the
 *     email is verified. The person who has just proved they own their mailbox
 *     must still get an account.
 */
describe("resolveViewerProfile, seeding identity from sign-up", () => {
  it("writes the name, handle and country the user gave before verifying", async () => {
    getAuthUser.mockResolvedValue(USER);
    authUser = { user_metadata: { full_name: "  Ada   Obi ", username: "AdaObi", country: "ng" } };
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: ROW, error: null });

    const { resolveViewerProfile } = await load();
    await resolveViewerProfile();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      username: "adaobi",
      display_name: "Ada Obi",
      country: "NG",
    });
  });

  it("falls back to the generated handle when there is no metadata at all", async () => {
    getAuthUser.mockResolvedValue(USER);
    authUser = { user_metadata: {} };
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: ROW, error: null });

    const { resolveViewerProfile } = await load();
    await resolveViewerProfile();

    // The `user_` prefix is load-bearing: it is what onboarding reads to decide
    // whether it still has to ask for a handle.
    expect(String(inserted[0].username)).toMatch(/^user_/);
    expect(inserted[0].display_name).toBeNull();
    expect(inserted[0].country).toBeNull();
  });

  it("drops metadata that would not pass the rules, instead of repairing it", async () => {
    getAuthUser.mockResolvedValue(USER);
    authUser = {
      user_metadata: {
        username: "ada obi",
        full_name: "x".repeat(200),
        country: "Nigeria",
        // Never read. The RLS insert policy pins both independently, but a
        // doctored blob must not even be consulted for them.
        role: "super_admin",
        moderation_status: "banned",
      },
    };
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle.mockResolvedValue({ data: ROW, error: null });

    const { resolveViewerProfile } = await load();
    await resolveViewerProfile();

    expect(String(inserted[0].username)).toMatch(/^user_/);
    expect(inserted[0].display_name).toBeNull();
    expect(inserted[0].country).toBeNull();
    expect(inserted[0]).not.toHaveProperty("role");
    expect(inserted[0]).not.toHaveProperty("moderation_status");
  });

  it("still creates the account when the chosen handle was taken while they verified", async () => {
    getAuthUser.mockResolvedValue(USER);
    authUser = { user_metadata: { username: "adaobi", full_name: "Ada Obi", country: "NG" } };
    // No row for this auth user before or after — the 23505 is somebody else's
    // claim on the handle, not this user's own row racing itself.
    maybeSingle.mockResolvedValue({ data: null, error: null });
    insertSingle
      .mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } })
      .mockResolvedValueOnce({ data: ROW, error: null });

    const { resolveViewerProfile } = await load();
    expect(await resolveViewerProfile()).toEqual({ status: "ready", profile: ROW });

    expect(inserted).toHaveLength(2);
    expect(inserted[0].username).toBe("adaobi");
    // Provisioned on the placeholder, which is exactly what makes onboarding ask
    // them to pick again rather than stranding them.
    expect(String(inserted[1].username)).toMatch(/^user_/);
    // The rest of what they told us survives — only the handle was contested.
    expect(inserted[1].display_name).toBe("Ada Obi");
    expect(inserted[1].country).toBe("NG");
  });
});
