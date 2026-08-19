import type { Database } from "@/lib/supabase/types";
import { isFixtureWorthSyncing } from "./live-worker-rules";

/**
 * Pure scheduling arithmetic for the live worker.
 *
 * Deliberately NOT `server-only`, for the same reason `live-worker-rules.ts`
 * is not: this is the part that decides how a hundred-request-a-day budget is
 * spent, and it has to be unit-testable without a database, a provider or a
 * request context. There is no route to api-football.com from the build
 * environment, so the *behaviour* of a live poll cannot be tested here — the
 * arithmetic that bounds it can be, and is (`live-sync-planner.test.ts`).
 *
 * ## The problem this solves
 *
 * The worker before this had six good guards and not one of them bounded total
 * spend. The quota floor only refuses once the provider's own remaining count
 * is already down to ten, and that number is `null` until some request has
 * recorded one. So with the flag on and one match live, the worker called the
 * fixtures sync every minute until the floor tripped: roughly ninety requests
 * in ninety minutes, and then the whole product has no data for the rest of the
 * day. A frozen score is bad; a product with no data at all is worse.
 *
 * ## The idea
 *
 * Do not pick an interval. Derive one.
 *
 * At any moment KIVO knows two real numbers: how many requests the live worker
 * has left today, and how many minutes of live football are left to cover. The
 * ratio of those is the pace — how often it can afford to look. Spreading the
 * budget across the football rather than across the clock is what stops the
 * first match of the day eating the day.
 *
 * On top of that pace, two adjustments, both bounded:
 *
 *   * **Tighten** around the minutes where a scoreline actually changes
 *     — the opening exchanges, the approach to half-time, the last ten. Capped
 *     so it can never consume the reserve it is borrowing from.
 *   * **Widen** when nothing has changed since the last look. A goalless
 *     twenty minutes is the cheapest thing in football to watch.
 *
 * Everything is clamped between a floor (the cron cadence — there is no point
 * planning faster than the scheduler fires) and a ceiling (past which a "live"
 * score is not live in any meaningful sense and the product should say so
 * rather than keep paying for it).
 */

type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

/** What the worker knows about one candidate fixture. */
export type LiveFixtureSnapshot = {
  status: FixtureStatus;
  kickoffAt: string;
  /** The provider's own clock. Null before kickoff and whenever unreported —
   * null is never treated as minute zero. */
  minuteElapsed: number | null;
  /** When KIVO last wrote this row. The change signal for the quiet widening. */
  updatedAt: string;
};

export type LiveSyncBudget = {
  /** The live worker's own allowance for the window. Not the provider's total. */
  limit: number;
  /** What this worker has already spent inside the window, from the ledger. */
  spentInWindow: number;
  /** The window's length. */
  windowSeconds: number;
  /**
   * When the oldest spend still inside the window falls out of it — the exact
   * moment an exhausted budget frees up one request. Null when nothing has been
   * spent.
   *
   * This is why the ledger uses a rolling window rather than a calendar day.
   * KIVO cannot establish when API-Football's own daily counter resets: this
   * build environment has no route to api-football.com, and the only quota
   * signal the adapter reads is `x-ratelimit-requests-remaining`, which is a
   * count and not a reset time. A trailing-window cap of N implies at most N in
   * ANY 24-hour interval, including whatever calendar day the provider actually
   * uses — so it is conservative under every possible reset, whereas assuming
   * UTC midnight would silently disable the budget for part of every day if the
   * assumption were wrong in the generous direction.
   */
  oldestSpendAt: string | null;
};

export type LiveSyncPlannerInput = {
  now: Date;
  /** Candidates from the coarse database query — the planner applies the real
   * relevance test itself. */
  fixtures: readonly LiveFixtureSnapshot[];
  /** When this worker last actually spent a request. Null when it never has. */
  lastSpendAt: string | null;
  budget: LiveSyncBudget;
  /** The provider's own remaining count, when one has ever been recorded.
   * Null is never treated as low — that would be guessing, not protecting. */
  quotaRemaining: number | null;
  quotaFloor: number;
  imminentWindowMinutes: number;
  staleScheduledCeilingHours: number;
};

export type LiveSkipReason =
  | "nothing_live"
  | "quota_floor"
  | "budget_exhausted"
  | "pacing";

export type LiveSyncPlan =
  | {
      action: "skip";
      reason: LiveSkipReason;
      /** Plain English, written straight onto the `sync_runs` row so an admin
       * reads a decision rather than a silence. */
      detail: string;
      /** When this worker could next do something, when that is knowable. */
      nextEligibleAt: string | null;
    }
  | {
      action: "sync";
      detail: string;
      /** The interval this decision was made against, in minutes. Surfaced so
       * Data Health can show the pace the worker is actually running at rather
       * than a configured number that may not be what is happening. */
      paceMinutes: number;
      nextEligibleAt: string;
    };

/**
 * How long after kickoff a fixture is still plausibly in progress: 90 minutes
 * plus a 15-minute interval plus generous added time and a buffer for a late
 * start. Used only to estimate how much live football is left to pay for, so
 * erring long is the safe direction — it spreads the budget wider, never
 * thinner than reality.
 */
export const LIVE_WINDOW_MINUTES = 135;

/** No point planning faster than the scheduler fires. */
export const MIN_PACE_MINUTES = 1;

/**
 * Past this, a "live" score is not live in any meaningful sense. The worker
 * stops tightening and the product's own freshness indicators take over —
 * saying the score may be stale is more honest than paying to be slightly less
 * stale.
 */
export const MAX_PACE_MINUTES = 15;

/** Tighten to half pace in the minutes where a scoreline actually changes. */
const ATTENTION_PACE_FACTOR = 0.5;

/** Widen when nothing has changed since the last look. */
const QUIET_PACE_FACTOR = 1.5;

/**
 * Tightening is borrowing from later in the day, so it stops once most of the
 * allowance is gone. Without this ceiling a frantic first half would spend the
 * evening's budget and the last match of the day would get nothing.
 */
const ATTENTION_BUDGET_CEILING_FRACTION = 0.75;

/** Minutes of a match where the scoreline is most likely to move. */
function isAttentionMinute(fixture: LiveFixtureSnapshot): boolean {
  if (fixture.status === "live" && fixture.minuteElapsed === null) {
    // Live with no clock reported yet is almost always the first minutes.
    return true;
  }
  const minute = fixture.minuteElapsed;
  if (minute === null) return false;
  // Opening exchanges, the approach to half-time, and the last ten plus added
  // time — the three windows a fan checks a score in.
  return minute <= 5 || (minute >= 40 && minute <= 48) || minute >= 80;
}

function isoPlusMinutes(from: Date, minutes: number): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

/**
 * When an exhausted rolling budget next frees a request: the moment the oldest
 * spend still inside the window falls out of it.
 *
 * Deliberately computed rather than assumed. An earlier draft of this used the
 * next UTC midnight, which is only correct if the provider resets at UTC
 * midnight — something this build could not establish. This number depends on
 * nothing but KIVO's own ledger and is therefore always true.
 */
export function budgetFreesUpAt(budget: LiveSyncBudget, now: Date): string {
  if (!budget.oldestSpendAt) return now.toISOString();
  return new Date(new Date(budget.oldestSpendAt).getTime() + budget.windowSeconds * 1000).toISOString();
}

export function planLiveSync(input: LiveSyncPlannerInput): LiveSyncPlan {
  const { now, budget } = input;

  const relevant = input.fixtures.filter((fixture) =>
    isFixtureWorthSyncing(fixture.status, fixture.kickoffAt, {
      imminentWindowMinutes: input.imminentWindowMinutes,
      staleScheduledCeilingHours: input.staleScheduledCeilingHours,
      now,
    }),
  );

  // 1. Nothing to see. The cheapest possible answer, and the most common one:
  // zero requests, and a real answer for when that changes.
  if (relevant.length === 0) {
    const upcoming = input.fixtures
      .filter((fixture) => fixture.status === "scheduled" && new Date(fixture.kickoffAt).getTime() > now.getTime())
      .map((fixture) => new Date(fixture.kickoffAt).getTime())
      .sort((a, b) => a - b)[0];

    return {
      action: "skip",
      reason: "nothing_live",
      detail: "Nothing is in play and nothing kicks off soon, so no request is worth making.",
      nextEligibleAt:
        upcoming === undefined
          ? null
          : new Date(upcoming - input.imminentWindowMinutes * 60_000).toISOString(),
    };
  }

  // 2. The provider's own floor, unchanged in meaning from the guard it
  // replaces: leave room for a human debugging with "Sync now".
  if (input.quotaRemaining !== null && input.quotaRemaining <= input.quotaFloor) {
    return {
      action: "skip",
      reason: "quota_floor",
      detail: `The provider reports ${input.quotaRemaining} requests left, at or below the ${input.quotaFloor} reserved for manual use.`,
      // The provider's own count is the one number here whose recovery time
      // KIVO genuinely does not know, so it does not pretend to.
      nextEligibleAt: null,
    };
  }

  // 3. The hard bound. This is the one the old worker did not have.
  const remainingBudget = budget.limit - budget.spentInWindow;
  if (remainingBudget <= 0) {
    return {
      action: "skip",
      reason: "budget_exhausted",
      detail: `The live worker has spent its whole allowance (${budget.spentInWindow} of ${budget.limit} in the last ${Math.round(budget.windowSeconds / 3600)} hours). Scores will not refresh again until some of it frees up.`,
      nextEligibleAt: budgetFreesUpAt(budget, now),
    };
  }

  // 4. Pace: the budget spread across the football that is left, not across
  // the clock. A fixture already past its window contributes nothing, so a
  // stuck 'scheduled' row cannot stretch the horizon forever.
  const horizonMs = relevant.reduce((latest, fixture) => {
    const end = new Date(fixture.kickoffAt).getTime() + LIVE_WINDOW_MINUTES * 60_000;
    return Math.max(latest, end);
  }, now.getTime());
  const remainingMinutes = Math.max(1, (horizonMs - now.getTime()) / 60_000);

  let pace = remainingMinutes / remainingBudget;

  const canBorrow = budget.spentInWindow < budget.limit * ATTENTION_BUDGET_CEILING_FRACTION;
  const attention = canBorrow && relevant.some(isAttentionMinute);

  // "Nothing has changed since we last looked" is read from the fixtures
  // themselves rather than from the last run's record count: a sync that wrote
  // 30 rows with identical values did not change anything a reader would see.
  const quiet =
    input.lastSpendAt !== null &&
    relevant.every((fixture) => new Date(fixture.updatedAt).getTime() <= new Date(input.lastSpendAt!).getTime());

  if (attention) pace *= ATTENTION_PACE_FACTOR;
  else if (quiet) pace *= QUIET_PACE_FACTOR;

  pace = Math.min(MAX_PACE_MINUTES, Math.max(MIN_PACE_MINUTES, pace));

  // 5. Pacing. Nothing is wrong; it is simply not time yet.
  if (input.lastSpendAt !== null) {
    const sinceMinutes = (now.getTime() - new Date(input.lastSpendAt).getTime()) / 60_000;
    if (sinceMinutes < pace) {
      return {
        action: "skip",
        reason: "pacing",
        detail: `Last refresh was ${sinceMinutes.toFixed(1)} minutes ago; current pace is one every ${pace.toFixed(1)} minutes to make ${remainingBudget} remaining requests cover ${Math.round(remainingMinutes)} minutes of football.`,
        nextEligibleAt: isoPlusMinutes(new Date(input.lastSpendAt), pace),
      };
    }
  }

  return {
    action: "sync",
    detail: attention
      ? `Refreshing at a tightened pace (one every ${pace.toFixed(1)} minutes): a match is in a window where the score is likely to change.`
      : quiet
        ? `Refreshing at a widened pace (one every ${pace.toFixed(1)} minutes): nothing has changed since the last look.`
        : `Refreshing at one every ${pace.toFixed(1)} minutes, pacing ${remainingBudget} remaining requests across ${Math.round(remainingMinutes)} minutes of football.`,
    paceMinutes: pace,
    nextEligibleAt: isoPlusMinutes(now, pace),
  };
}
