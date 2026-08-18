import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseDouble } from "@/lib/supabase/query-double";

/**
 * KN-130. The kickoff lock, tested.
 *
 * `submitPrediction` is where KIVO's no-gambling, no-hindsight position is
 * actually enforced: predictions must be impossible once a match has started.
 * The item's own note explains why this cannot be left to the database — no
 * job populates `fixtures.locked_at`, so RLS's `locked_at is null` check
 * passes for every fixture, and this function is the only thing standing
 * between a user and predicting a result they have already seen.
 *
 * That makes these the highest-value tests in the file: each one asserts not
 * only the returned error but that **nothing was written**, because an action
 * that rejects in its message and writes anyway is the exact failure a
 * message-only assertion misses.
 */

const profileMock = vi.fn();
const rateLimitMock = vi.fn();
let double: ReturnType<typeof createSupabaseDouble>;

vi.mock("@/lib/profile", () => ({ getOrCreateProfile: () => profileMock() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => rateLimitMock() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => double.client,
}));

const VIEWER = { id: "profile-1" };
const HOUR = 60 * 60 * 1000;

function future() {
  return new Date(Date.now() + 2 * HOUR).toISOString();
}
function past() {
  return new Date(Date.now() - 2 * HOUR).toISOString();
}

async function submit(fixtureId = "fixture-1") {
  const { submitPrediction } = await import("./actions");
  return submitPrediction(fixtureId, "home_win");
}

beforeEach(() => {
  vi.resetModules();
  profileMock.mockReset().mockResolvedValue(VIEWER);
  rateLimitMock.mockReset().mockResolvedValue({ ok: true });
});

describe("submitPrediction authorization", () => {
  it("refuses a signed-out caller before touching the database", async () => {
    profileMock.mockResolvedValue(null);
    double = createSupabaseDouble({});

    const result = await submit();

    expect(result.error).toMatch(/signed in/i);
    expect(double.calls).toHaveLength(0);
  });

  it("refuses a rate-limited caller without writing", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, error: "Slow down." });
    double = createSupabaseDouble({});

    const result = await submit();

    expect(result.error).toBe("Slow down.");
    expect(double.wrote("predictions")).toBe(false);
  });

  it("refuses a fixture that does not exist", async () => {
    double = createSupabaseDouble({ fixtures: { data: null, error: null } });

    const result = await submit();

    expect(result.error).toMatch(/no longer exists/i);
    expect(double.wrote("predictions")).toBe(false);
  });
});

describe("submitPrediction kickoff lock", () => {
  it("accepts a prediction on a scheduled fixture that has not kicked off", async () => {
    double = createSupabaseDouble({
      fixtures: { data: { kickoff_at: future(), status: "scheduled" }, error: null },
      predictions: { data: null, error: null },
    });

    const result = await submit();

    expect(result.error).toBeNull();
    expect(double.wrote("predictions")).toBe(true);
  });

  it("rejects a fixture whose kickoff time has passed, and writes nothing", async () => {
    double = createSupabaseDouble({
      fixtures: { data: { kickoff_at: past(), status: "scheduled" }, error: null },
      predictions: { data: null, error: null },
    });

    const result = await submit();

    expect(result.error).toMatch(/lock at kickoff/i);
    expect(double.wrote("predictions")).toBe(false);
  });

  it.each(["live", "halftime", "finished", "postponed"])(
    "rejects a fixture in %s status even when its kickoff_at is still in the future",
    async (status) => {
      // A postponed-then-rescheduled fixture can genuinely carry a future
      // kickoff while not being open for predictions, so the status check has
      // to stand on its own rather than being implied by the clock.
      double = createSupabaseDouble({
        fixtures: { data: { kickoff_at: future(), status }, error: null },
        predictions: { data: null, error: null },
      });

      const result = await submit();

      expect(result.error).toMatch(/lock at kickoff/i);
      expect(double.wrote("predictions")).toBe(false);
    },
  );

  it("treats a fixture kicking off at exactly this instant as locked", async () => {
    // The comparison is `<=`, deliberately: at exactly kickoff the match has
    // started, and the tie has to break closed. Time is frozen so this really
    // does test the boundary — with a real clock, `new Date()` inside the
    // action is evaluated after the timestamp is built, so the fixture is
    // always a millisecond in the past and a `<` would pass this too.
    vi.useFakeTimers();
    try {
      const now = new Date("2026-08-18T20:00:00.000Z");
      vi.setSystemTime(now);
      double = createSupabaseDouble({
        fixtures: { data: { kickoff_at: now.toISOString(), status: "scheduled" }, error: null },
        predictions: { data: null, error: null },
      });

      const result = await submit();

      expect(result.error).toMatch(/lock at kickoff/i);
      expect(double.wrote("predictions")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("submitPrediction persistence", () => {
  it("upserts against the profile that is signed in, never a caller-supplied id", async () => {
    double = createSupabaseDouble({
      fixtures: { data: { kickoff_at: future(), status: "scheduled" }, error: null },
      predictions: { data: null, error: null },
    });

    await submit("fixture-9");

    const write = double.calls.find((call) => call.table === "predictions");
    expect(write?.payload).toMatchObject({
      profile_id: VIEWER.id,
      fixture_id: "fixture-9",
      predicted_outcome: "home_win",
    });
  });

  it("reports a write failure instead of claiming success", async () => {
    double = createSupabaseDouble({
      fixtures: { data: { kickoff_at: future(), status: "scheduled" }, error: null },
      predictions: { data: null, error: { message: "deadlock detected" } },
    });

    const result = await submit();

    expect(result.error).toMatch(/couldn't save/i);
  });
});
