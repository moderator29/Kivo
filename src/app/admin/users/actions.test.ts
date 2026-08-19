import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseDouble } from "@/lib/supabase/query-double";

/**
 * KN-130. Every admin moderation action's role gate.
 *
 * RLS is the real backstop here and the file's own header says so — but that
 * argument only holds while the RLS admin branch and `canViewUserData` agree
 * about what "admin" means, and nothing was checking that they do. Worse, one
 * of these rules has **no RLS equivalent at all**: the self-target lock. The
 * database's self-tamper trigger only stops a *non-admin* clearing their own
 * restriction, so an admin acting on themselves sails straight through the
 * admin branch and can ban their own account — potentially the only admin
 * account — with no way back in. That check exists only in this file, which
 * makes it exactly the kind of thing a test has to hold down.
 *
 * Each case asserts that nothing was written, not just that an error came
 * back: an action that refuses in its message and updates anyway is the
 * failure a message-only assertion cannot see.
 */

const profileMock = vi.fn();
let double: ReturnType<typeof createSupabaseDouble>;

vi.mock("@/lib/profile", () => ({ getOrCreateProfile: () => profileMock() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => double.client,
}));

const ADMIN = { id: "admin-1", role: "admin" };
const TARGET = "profile-2";

async function actions() {
  return import("./actions");
}

beforeEach(() => {
  vi.resetModules();
  profileMock.mockReset().mockResolvedValue(ADMIN);
  double = createSupabaseDouble({
    profiles: { data: { username: "someone" }, error: null },
    // Every action now also appends to the moderation_actions ledger, so the
    // double has to have something queued for it or the write throws.
    moderation_actions: { data: null, error: null },
  });
});

describe("admin user actions: who is allowed in", () => {
  // The roles that exist but must NOT reach user administration. `moderator`
  // is the important one: it is a real, granted role that can act on reports,
  // and it must still not be able to ban an account.
  it.each(["user", "moderator", "football_data_admin", "content_admin", "support_admin", "analyst"])(
    "refuses role %s",
    async (role) => {
      profileMock.mockResolvedValue({ id: "actor", role });
      const { suspendUser, banUser, shadowMuteUser, reinstateUser } = await actions();

      for (const call of [
        () => suspendUser(TARGET, 7, "spam", "active"),
        () => banUser(TARGET, "spam", "active"),
        () => shadowMuteUser(TARGET, "why", "active"),
        () => reinstateUser(TARGET, "why", "banned"),
      ]) {
        const result = await call();
        expect(result.error).toMatch(/don't have user admin access/i);
      }
      expect(double.wrote("profiles")).toBe(false);
    },
  );

  it.each(["admin", "super_admin"])("allows role %s", async (role) => {
    profileMock.mockResolvedValue({ id: "actor", role });
    const { suspendUser } = await actions();

    const result = await suspendUser(TARGET, 7, "spam", "active");

    expect(result.error).toBeNull();
    expect(double.wrote("profiles")).toBe(true);
  });

  it("refuses a signed-out caller", async () => {
    profileMock.mockResolvedValue(null);
    const { banUser } = await actions();

    const result = await banUser(TARGET, "spam", "active");

    expect(result.error).toMatch(/don't have user admin access/i);
    expect(double.wrote("profiles")).toBe(false);
  });
});

describe("admin user actions: the self-target lock RLS does not provide", () => {
  type Actions = Awaited<ReturnType<typeof actions>>;
  it.each([
    ["suspendUser", (a: Actions) => a.suspendUser(ADMIN.id, 7, "why", "active")],
    ["banUser", (a: Actions) => a.banUser(ADMIN.id, "why", "active")],
    ["shadowMuteUser", (a: Actions) => a.shadowMuteUser(ADMIN.id, "why", "active")],
    ["reinstateUser", (a: Actions) => a.reinstateUser(ADMIN.id, "why", "banned")],
  ])("stops an admin applying %s to their own account", async (_name, call) => {
    const loaded = await actions();

    const result = await call(loaded);

    expect(result.error).toMatch(/your own account/i);
    expect(double.wrote("profiles")).toBe(false);
  });
});

describe("admin user actions: input validation", () => {
  it("rejects a suspension duration that is not one of the offered options", async () => {
    const { suspendUser } = await actions();

    // 365 is not in SUSPEND_DURATIONS_DAYS. A server action is a public HTTP
    // endpoint — the fact that the UI only offers four buttons constrains
    // nobody.
    const result = await suspendUser(TARGET, 365 as never, "spam", "active");

    expect(result.error).toMatch(/invalid suspension duration/i);
    expect(double.wrote("profiles")).toBe(false);
  });

  it("requires a reason, and rejects whitespace masquerading as one", async () => {
    const { suspendUser } = await actions();

    const result = await suspendUser(TARGET, 7, "   ", "active");

    expect(result.error).toMatch(/reason is required/i);
    expect(double.wrote("profiles")).toBe(false);
  });

  it("rejects a reason longer than the column's own check constraint allows", async () => {
    // Matches profiles_moderation_reason_length in migration 0045. Without
    // this the write reaches Postgres and fails with a raw constraint error.
    const { banUser } = await actions();

    const result = await banUser(TARGET, "x".repeat(501), "active");

    expect(result.error).toMatch(/500 characters or fewer/i);
    expect(double.wrote("profiles")).toBe(false);
  });
});

describe("admin user actions: what gets written", () => {
  it("records the acting admin on the row, not the target", async () => {
    const { suspendUser } = await actions();

    await suspendUser(TARGET, 3, "repeated spam", "active");

    const write = double.calls.find((call) => call.table === "profiles");
    expect(write?.payload).toMatchObject({
      moderation_status: "suspended",
      moderation_reason: "repeated spam",
      moderation_set_by: ADMIN.id,
    });
  });

  it("reports a failed update instead of claiming the user was suspended", async () => {
    double = createSupabaseDouble({ profiles: { data: null, error: { message: "permission denied" } } });
    const { suspendUser } = await actions();

    const result = await suspendUser(TARGET, 7, "spam", "active");

    expect(result.error).toMatch(/couldn't suspend/i);
  });
});

describe("admin user actions: acting on a state the admin never saw", () => {
  /**
   * The compare-and-swap. This is the check that stops the worst thing this
   * tool can do quietly: a "Suspend" issued from a screen loaded when the
   * account was active, landing on an account a colleague has since banned,
   * would previously downgrade a permanent ban to a three-day suspension and
   * report success. Nobody would ever know an account had been released.
   *
   * A matched-nothing update returns `data: null` with no error, which is
   * indistinguishable from "row gone" without a second read — so the action
   * does that read and names which of the two happened.
   */
  it("refuses when the account's status has moved on, and says what it is now", async () => {
    double = createSupabaseDouble({
      profiles: [
        // The conditional update matched nothing.
        { data: null, error: null },
        // The follow-up read: the account is really banned now.
        { data: { moderation_status: "banned" }, error: null },
      ],
      moderation_actions: { data: null, error: null },
    });
    const { suspendUser } = await actions();

    const result = await suspendUser(TARGET, 3, "spam", "active");

    expect(result.error).toMatch(/now banned, not active/i);
    expect(result.error).toMatch(/reload/i);
  });

  it("distinguishes a vanished account from a changed one", async () => {
    double = createSupabaseDouble({
      profiles: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      moderation_actions: { data: null, error: null },
    });
    const { banUser } = await actions();

    const result = await banUser(TARGET, "spam", "active");

    expect(result.error).toMatch(/no longer exists/i);
  });

  it("rejects an expected status that is not a real moderation status", async () => {
    // The guard is only worth having if it cannot be waved away by sending
    // something the enum has never contained. A server action is a public
    // endpoint; the UI's four values constrain nobody.
    const { banUser } = await actions();

    const result = await banUser(TARGET, "spam", "whatever" as never);

    expect(result.error).toMatch(/reload the page/i);
    expect(double.wrote("profiles")).toBe(false);
  });
});

describe("admin user actions: reversals are recorded too", () => {
  it.each([
    ["shadowMuteUser", (a: Awaited<ReturnType<typeof actions>>) => a.shadowMuteUser(TARGET, "  ", "active")],
    ["reinstateUser", (a: Awaited<ReturnType<typeof actions>>) => a.reinstateUser(TARGET, "  ", "banned")],
  ])("requires an internal note for %s", async (_name, call) => {
    const loaded = await actions();

    const result = await call(loaded);

    expect(result.error).toMatch(/internal note is required/i);
    expect(double.wrote("profiles")).toBe(false);
  });

  it("keeps a shadow-mute's note out of the user-facing reason column", async () => {
    // profiles.moderation_reason is shown to the user. A shadow-mute the user
    // can read the reason for is not a shadow-mute — the note belongs in the
    // ledger only.
    const { shadowMuteUser } = await actions();

    await shadowMuteUser(TARGET, "coordinated brigading", "active");

    const profileWrite = double.calls.find((call) => call.table === "profiles");
    expect(profileWrite?.payload).toMatchObject({ moderation_status: "shadow_muted", moderation_reason: null });

    const ledgerWrite = double.calls.find((call) => call.table === "moderation_actions");
    expect(ledgerWrite?.payload).toMatchObject({
      action: "shadow_mute_user",
      target_type: "profile",
      reason: "coordinated brigading",
    });
  });

  it("writes an account sanction to the moderation ledger, not only the audit log", async () => {
    const { banUser } = await actions();

    await banUser(TARGET, "repeated abuse", "active");

    const ledgerWrite = double.calls.find((call) => call.table === "moderation_actions");
    expect(ledgerWrite?.payload).toMatchObject({
      admin_profile_id: ADMIN.id,
      action: "ban_user",
      target_type: "profile",
      target_id: TARGET,
      reason: "repeated abuse",
    });
  });
});
