import { MIN_FORM_SAMPLE } from "./form-engine";

/**
 * Pure goal-timing aggregation (RECOMMENDATIONS.md item 162) — DB-free, same
 * convention as form-engine.ts and results.ts, split out of
 * match-intelligence.ts specifically so it can be unit tested without
 * pulling in that module's `server-only` pragma (match-intelligence.ts
 * queries Supabase directly, same as head-to-head.ts, and none of this
 * codebase's other DB-touching modules have a test file for that reason).
 */

export type TeamGoalTiming = {
  /** Real goals this team has scored across every finished match KIVO has
   * synced for it — 'goal' and 'penalty_goal' events only. */
  goalsScored: number;
  goalsAfter70: number;
  /** Real finished-match count this was computed from — the honesty
   * denominator every consumer must show alongside the figure. */
  finishedMatchesSample: number;
  isSufficientSample: boolean;
  minSampleRequired: number;
};

/**
 * Aggregates a team's real goal-scoring minutes into a timing split. Callers
 * fetch the minutes and the finished-match denominator themselves (same
 * "caller resolves, this module only aggregates" split as form-engine.ts).
 */
export function summarizeGoalTiming(goalMinutes: number[], finishedMatchesSample: number): TeamGoalTiming {
  const goalsScored = goalMinutes.length;
  const goalsAfter70 = goalMinutes.filter((minute) => minute >= 70).length;
  return {
    goalsScored,
    goalsAfter70,
    finishedMatchesSample,
    // Reuses form-engine's MIN_FORM_SAMPLE rather than inventing a separate
    // arbitrary threshold — one honest "is this enough real matches" bar
    // across the whole match-intelligence module.
    isSufficientSample: finishedMatchesSample >= MIN_FORM_SAMPLE,
    minSampleRequired: MIN_FORM_SAMPLE,
  };
}
