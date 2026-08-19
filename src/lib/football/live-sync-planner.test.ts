import { describe, expect, it } from "vitest";
import {
  LIVE_WINDOW_MINUTES,
  MAX_PACE_MINUTES,
  MIN_PACE_MINUTES,
  budgetFreesUpAt,
  planLiveSync,
  type LiveFixtureSnapshot,
  type LiveSyncPlannerInput,
} from "./live-sync-planner";

const NOW = new Date("2026-08-19T15:00:00.000Z");

function fixture(overrides: Partial<LiveFixtureSnapshot> = {}): LiveFixtureSnapshot {
  return {
    status: "live",
    kickoffAt: "2026-08-19T14:30:00.000Z",
    minuteElapsed: 30,
    updatedAt: "2026-08-19T14:59:00.000Z",
    ...overrides,
  };
}

function input(overrides: Partial<LiveSyncPlannerInput> = {}): LiveSyncPlannerInput {
  return {
    now: NOW,
    fixtures: [fixture()],
    lastSpendAt: null,
    budget: { limit: 55, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null },
    quotaRemaining: null,
    quotaFloor: 10,
    imminentWindowMinutes: 10,
    staleScheduledCeilingHours: 3,
    ...overrides,
  };
}

describe("planLiveSync — the guards that bound total spend", () => {
  it("spends nothing when nothing is in play, and says when that changes", () => {
    const plan = planLiveSync(
      input({
        fixtures: [
          fixture({ status: "finished", minuteElapsed: 90 }),
          fixture({ status: "scheduled", kickoffAt: "2026-08-19T18:00:00.000Z", minuteElapsed: null }),
        ],
      }),
    );
    expect(plan.action).toBe("skip");
    if (plan.action !== "skip") throw new Error("unreachable");
    expect(plan.reason).toBe("nothing_live");
    // Ten minutes before the 18:00 kickoff — the imminent window.
    expect(plan.nextEligibleAt).toBe("2026-08-19T17:50:00.000Z");
  });

  it("returns a null next-eligible time when there is genuinely nothing upcoming", () => {
    const plan = planLiveSync(input({ fixtures: [fixture({ status: "finished" })] }));
    if (plan.action !== "skip") throw new Error("expected skip");
    expect(plan.nextEligibleAt).toBeNull();
  });

  it("refuses once the worker's own allowance is gone, and this is the bound the old worker lacked", () => {
    const plan = planLiveSync(input({ budget: { limit: 55, spentInWindow: 55, windowSeconds: 86_400, oldestSpendAt: "2026-08-19T09:00:00.000Z" } }));
    expect(plan.action).toBe("skip");
    if (plan.action !== "skip") throw new Error("unreachable");
    expect(plan.reason).toBe("budget_exhausted");
    expect(plan.detail).toContain("55 of 55");
    // Exactly when the oldest counted spend falls out of the trailing window —
    // computed from the ledger, never assumed to be a calendar boundary.
    expect(plan.nextEligibleAt).toBe("2026-08-20T09:00:00.000Z");
  });

  it("still honours the provider's own floor, and never treats an unknown count as low", () => {
    const low = planLiveSync(input({ quotaRemaining: 10 }));
    expect(low.action).toBe("skip");
    if (low.action !== "skip") throw new Error("unreachable");
    expect(low.reason).toBe("quota_floor");

    // Null is "KIVO has never recorded a reading", not "we are out".
    expect(planLiveSync(input({ quotaRemaining: null })).action).toBe("sync");
  });
});

describe("planLiveSync — pace is derived, never configured", () => {
  it("spreads the remaining budget across the football that is left, not across the clock", () => {
    // One fixture kicked off 30 minutes ago, so 105 minutes of window remain.
    // With 10 requests left that is one every ~10.5 minutes, clamped to 15.
    const plan = planLiveSync(input({ budget: { limit: 55, spentInWindow: 45, windowSeconds: 86_400, oldestSpendAt: "2026-08-19T09:00:00.000Z" } }));
    if (plan.action !== "sync") throw new Error("expected sync");
    expect(plan.paceMinutes).toBeCloseTo(10.5, 1);

    // The same fixture with the full budget left is far more frequent.
    const rich = planLiveSync(input());
    if (rich.action !== "sync") throw new Error("expected sync");
    expect(rich.paceMinutes).toBeLessThan(plan.paceMinutes);
  });

  it("never plans faster than the scheduler fires, or slower than a score stops being live", () => {
    const fast = planLiveSync(input({ budget: { limit: 10_000, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null } }));
    if (fast.action !== "sync") throw new Error("expected sync");
    expect(fast.paceMinutes).toBe(MIN_PACE_MINUTES);

    const slow = planLiveSync(input({ budget: { limit: 2, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null } }));
    if (slow.action !== "sync") throw new Error("expected sync");
    expect(slow.paceMinutes).toBe(MAX_PACE_MINUTES);
  });

  it("tightens in the minutes a scoreline actually moves", () => {
    const midMatch = planLiveSync(input({ budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null }, fixtures: [fixture({ minuteElapsed: 30 })] }));
    const lateOn = planLiveSync(input({ budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null }, fixtures: [fixture({ minuteElapsed: 85 })] }));
    if (midMatch.action !== "sync" || lateOn.action !== "sync") throw new Error("expected sync");
    expect(lateOn.paceMinutes).toBeLessThan(midMatch.paceMinutes);
    expect(lateOn.detail).toContain("tightened");
  });

  it("stops tightening once most of the allowance is gone, so a frantic first half cannot eat the evening", () => {
    const early = planLiveSync(input({ budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null }, fixtures: [fixture({ minuteElapsed: 85 })] }));
    const late = planLiveSync(input({ budget: { limit: 20, spentInWindow: 16, windowSeconds: 86_400, oldestSpendAt: "2026-08-19T09:00:00.000Z" }, fixtures: [fixture({ minuteElapsed: 85 })] }));
    if (early.action !== "sync" || late.action !== "sync") throw new Error("expected sync");
    expect(early.detail).toContain("tightened");
    expect(late.detail).not.toContain("tightened");
  });

  it("widens when nothing has changed since the last look", () => {
    const changed = planLiveSync(
      input({
        budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null },
        lastSpendAt: "2026-08-19T14:00:00.000Z",
        fixtures: [fixture({ minuteElapsed: 30, updatedAt: "2026-08-19T14:30:00.000Z" })],
      }),
    );
    const unchanged = planLiveSync(
      input({
        budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null },
        lastSpendAt: "2026-08-19T14:00:00.000Z",
        fixtures: [fixture({ minuteElapsed: 30, updatedAt: "2026-08-19T13:50:00.000Z" })],
      }),
    );
    if (changed.action !== "sync" || unchanged.action !== "sync") throw new Error("expected sync");
    expect(unchanged.paceMinutes).toBeGreaterThan(changed.paceMinutes);
    expect(unchanged.detail).toContain("widened");
  });

  it("holds off between spends, and says exactly when it will next look", () => {
    // 20 requests over ~105 minutes is one every ~5.25 minutes; one minute ago
    // is too soon.
    const plan = planLiveSync(
      input({
        budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null },
        lastSpendAt: "2026-08-19T14:59:00.000Z",
        fixtures: [fixture({ minuteElapsed: 30, updatedAt: "2026-08-19T14:59:30.000Z" })],
      }),
    );
    expect(plan.action).toBe("skip");
    if (plan.action !== "skip") throw new Error("unreachable");
    expect(plan.reason).toBe("pacing");
    expect(plan.nextEligibleAt).not.toBeNull();
    expect(new Date(plan.nextEligibleAt!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("syncs once enough time has passed", () => {
    const plan = planLiveSync(
      input({
        budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null },
        lastSpendAt: "2026-08-19T14:40:00.000Z",
        fixtures: [fixture({ minuteElapsed: 30, updatedAt: "2026-08-19T14:59:00.000Z" })],
      }),
    );
    expect(plan.action).toBe("sync");
  });

  it("cannot have its horizon stretched forever by a fixture the provider never closed", () => {
    // A 'scheduled' row whose kickoff passed hours ago is not relevant at all
    // (the stale ceiling), so it can neither trigger a sync nor widen the
    // horizon that paces one.
    const plan = planLiveSync(
      input({
        fixtures: [fixture({ status: "scheduled", kickoffAt: "2026-08-19T04:00:00.000Z", minuteElapsed: null })],
      }),
    );
    if (plan.action !== "skip") throw new Error("expected skip");
    expect(plan.reason).toBe("nothing_live");
  });

  it("paces against the latest-finishing fixture when several are in play", () => {
    const plan = planLiveSync(
      input({
        budget: { limit: 20, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null },
        fixtures: [
          fixture({ kickoffAt: "2026-08-19T14:00:00.000Z", minuteElapsed: 60 }),
          fixture({ kickoffAt: "2026-08-19T14:55:00.000Z", minuteElapsed: 5 }),
        ],
      }),
    );
    if (plan.action !== "sync") throw new Error("expected sync");
    // The later kickoff sets the horizon: 14:55 + 135 minutes = 17:10, which is
    // 130 minutes from now.
    const expectedHorizonMinutes = 55 + LIVE_WINDOW_MINUTES - 60;
    expect(plan.paceMinutes).toBeLessThanOrEqual(expectedHorizonMinutes / 20);
  });
});

describe("budgetFreesUpAt", () => {
  it("is when the oldest counted spend leaves the trailing window, not a calendar boundary", () => {
    expect(
      budgetFreesUpAt(
        { limit: 55, spentInWindow: 55, windowSeconds: 86_400, oldestSpendAt: "2026-08-19T09:00:00.000Z" },
        NOW,
      ),
    ).toBe("2026-08-20T09:00:00.000Z");
  });

  it("is now when nothing has been spent — there is nothing to wait for", () => {
    expect(budgetFreesUpAt({ limit: 55, spentInWindow: 0, windowSeconds: 86_400, oldestSpendAt: null }, NOW)).toBe(
      NOW.toISOString(),
    );
  });
});
