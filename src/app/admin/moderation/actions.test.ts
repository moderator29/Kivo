import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseDouble } from "@/lib/supabase/query-double";

/**
 * `resolveReport`, tested at the three points where it can produce a wrong
 * moderation outcome quietly.
 *
 * A moderation tool's failures are not like other failures: the action is
 * often irreversible and the person on the other end is a real user. All
 * three cases below returned `{ error: null }` before — the tool reported
 * success while doing the wrong thing, which is the only failure mode a
 * moderator cannot catch by reading the screen.
 */

const profileMock = vi.fn();
const rateLimitMock = vi.fn();
let double: ReturnType<typeof createSupabaseDouble>;

vi.mock("@/lib/profile", () => ({ getOrCreateProfile: () => profileMock() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => rateLimitMock() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: () => double.client }));

const MODERATOR = { id: "mod-1", role: "moderator" };
const REPORT = "report-1";

async function actions() {
  return import("./actions");
}

/** A report that was still open and has now been claimed by this caller. */
function openReport() {
  return { data: { id: REPORT, target_type: "post", target_id: "post-1" }, error: null };
}

beforeEach(() => {
  vi.resetModules();
  profileMock.mockReset().mockResolvedValue(MODERATOR);
  rateLimitMock.mockReset().mockResolvedValue({ ok: true });
  double = createSupabaseDouble({
    reports: openReport(),
    moderation_actions: { data: null, error: null },
  });
});

describe("resolveReport: who is allowed in", () => {
  it.each(["user", "football_data_admin", "analyst"])("refuses role %s", async (role) => {
    profileMock.mockResolvedValue({ id: "x", role });
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "actioned", "");

    expect(result.error).toMatch(/don't have moderation access/i);
    expect(double.wrote("reports")).toBe(false);
  });

  it("refuses a signed-out caller before touching the database", async () => {
    profileMock.mockResolvedValue(null);
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "dismissed", "");

    expect(result.error).toMatch(/don't have moderation access/i);
    expect(double.wrote("reports")).toBe(false);
  });
});

describe("resolveReport: the decision is validated at runtime", () => {
  /**
   * `report_status` has four values and only two are decisions. A Server
   * Action is an HTTP endpoint, so the TypeScript union constrains nobody —
   * without the runtime check, "pending" would reopen a report while writing
   * a `moderation_actions` row recording "pending" as the verdict.
   */
  it.each(["pending", "reviewing", "deleted", "", "actioned "])(
    "refuses the decision %j without writing anything",
    async (decision) => {
      const { resolveReport } = await actions();

      const result = await resolveReport(REPORT, decision as never, "");

      expect(result.error).toMatch(/isn't a decision/i);
      expect(double.wrote("reports")).toBe(false);
    },
  );

  it.each(["actioned", "dismissed"])("accepts the real decision %s", async (decision) => {
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, decision as never, "");

    expect(result.error).toBeNull();
    const write = double.calls.find((call) => call.table === "reports");
    expect(write?.payload).toMatchObject({ status: decision, resolved_by_profile_id: MODERATOR.id });
  });
});

describe("resolveReport: it cannot be issued twice", () => {
  /**
   * The old shape read the status and then issued an unconditional update, so
   * two moderators working the same queue both passed the read and both wrote.
   * The update is now conditional on the report still being open; a caller who
   * matches nothing is told who won rather than silently re-deciding.
   */
  it("tells the loser of a race who resolved it, and writes no second ledger row", async () => {
    double = createSupabaseDouble({
      reports: [
        { data: null, error: null },
        { data: { status: "actioned", resolved_by: { username: "otheradmin" } }, error: null },
      ],
      moderation_actions: { data: null, error: null },
    });
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "dismissed", "");

    expect(result.error).toMatch(/already resolved as actioned by @otheradmin/i);
    expect(double.wrote("moderation_actions")).toBe(false);
  });

  it("still reports honestly when the winning moderator's account is gone", async () => {
    double = createSupabaseDouble({
      reports: [
        { data: null, error: null },
        { data: { status: "dismissed", resolved_by: null }, error: null },
      ],
      moderation_actions: { data: null, error: null },
    });
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "actioned", "");

    expect(result.error).toMatch(/already resolved as dismissed/i);
  });

  it("separates a report that was resolved from one that no longer exists", async () => {
    double = createSupabaseDouble({
      reports: [
        { data: null, error: null },
        { data: null, error: null },
      ],
      moderation_actions: { data: null, error: null },
    });
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "actioned", "");

    expect(result.error).toMatch(/no longer exists/i);
  });

  it("constrains the update to a report that is still open", async () => {
    const { resolveReport } = await actions();

    await resolveReport(REPORT, "actioned", "");

    // The `in` in this chain IS the guard. If it ever disappears, the
    // double-resolve returns.
    const write = double.calls.find((call) => call.table === "reports");
    expect(write?.chain).toContain("in");
  });
});

describe("resolveReport: what gets recorded", () => {
  it("writes the moderation ledger row against the report's real target", async () => {
    const { resolveReport } = await actions();

    await resolveReport(REPORT, "actioned", "  removed under rule 3  ");

    const ledger = double.calls.find((call) => call.table === "moderation_actions");
    expect(ledger?.payload).toMatchObject({
      admin_profile_id: MODERATOR.id,
      action: "actioned",
      target_type: "post",
      target_id: "post-1",
      reason: "removed under rule 3",
      report_id: REPORT,
    });
  });

  it("stores no reason rather than an empty string when the note is blank", async () => {
    const { resolveReport } = await actions();

    await resolveReport(REPORT, "dismissed", "   ");

    const ledger = double.calls.find((call) => call.table === "moderation_actions");
    expect(ledger?.payload).toMatchObject({ reason: null });
  });

  it("refuses a note longer than the ledger column's own limit", async () => {
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "actioned", "x".repeat(501));

    expect(result.error).toMatch(/500 characters or fewer/i);
    expect(double.wrote("reports")).toBe(false);
  });

  it("reports a failed update instead of claiming the report was resolved", async () => {
    double = createSupabaseDouble({
      reports: { data: null, error: { message: "permission denied" } },
      moderation_actions: { data: null, error: null },
    });
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "actioned", "");

    expect(result.error).toMatch(/couldn't update the report/i);
  });
});

describe("resolveReport: the privileged path is bounded", () => {
  it("stops at the rate limit before writing", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, error: "You're doing that too quickly.", retryAfterSeconds: 30 });
    const { resolveReport } = await actions();

    const result = await resolveReport(REPORT, "actioned", "");

    expect(result.error).toMatch(/too quickly/i);
    expect(double.wrote("reports")).toBe(false);
  });
});
