import { CheckCircle2, Clock, MinusCircle, XCircle, type LucideIcon } from "lucide-react";
import type { FixtureStatus } from "@/lib/football/fixture-status";

// Shared between the admin scoring action and the Data Health page's copy —
// a "use server" file may only export async functions, so these live here
// rather than alongside scorePredictions() in predictions-actions.ts.
export const CORRECT_PREDICTION_POINTS = 3;
export const CORRECT_PREDICTION_XP = 15;

export type PredictionOutcome = "home_win" | "draw" | "away_win";

// Shared between the prediction card (picking an outcome) and the "my
// predictions" history view (showing what was picked) so the label for a
// given outcome never drifts between the two.
export const PREDICTION_OUTCOME_LABEL: Record<PredictionOutcome, string> = {
  home_win: "Home",
  draw: "Draw",
  away_win: "Away",
};

export type StreakSummary = { current: number; best: number };

/**
 * RECOMMENDATIONS.md item 169: current and best runs of consecutive correct
 * predictions, derived purely from a user's own scored predictions
 * (points_awarded not null) ordered by the fixture's real kickoff_at — not
 * created_at, since a prediction can be made well before, or shortly before,
 * a fixture it doesn't necessarily rank chronologically against other
 * predictions by submission time. "Correct" means points_awarded > 0, the
 * same definition /predictions/mine and scorePredictions already use for
 * accuracy, so streak and accuracy can never quietly disagree about what
 * counts as a hit.
 *
 * Shared by /predictions/mine (display) and scorePredictions
 * (predictions-actions.ts, badge award criteria for three_prediction_streak)
 * so the two can't drift into different definitions of "streak".
 */
export function computeStreaks(scoredRows: { pointsAwarded: number; kickoffAt: string }[]): StreakSummary {
  const chronological = [...scoredRows].sort(
    (a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
  );

  // A single forward pass gets both numbers: `running` resets to 0 on every
  // miss and otherwise accumulates, so its value after the last row is
  // exactly the trailing run counting back from the most recently kicked-off
  // scored prediction — i.e. the current streak — while `best` tracks the
  // longest run `running` ever reached along the way.
  let best = 0;
  let running = 0;
  for (const row of chronological) {
    if (row.pointsAwarded > 0) {
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  }

  return { current: running, best };
}

export type PredictionResultInfo = { label: string; className: string; icon: LucideIcon };

/**
 * A prediction's result, purely from real columns — `points_awarded` is null
 * until the admin scoring pass (predictions-actions.ts's scorePredictions)
 * resolves it, so "not scored yet" is shown honestly rather than as a 0 or a
 * guessed outcome. Never derives correctness from the fixture score
 * directly: `points_awarded` is the single source of truth for what was
 * actually graded, same as the leaderboard.
 *
 * Shared between /predictions/mine (where this was originally defined) and
 * Match Centre's "You predicted" card (RECOMMENDATIONS.md item 293) so the
 * two can never disagree about what a given prediction row's result reads
 * as — the exact "reuse /predictions/mine's existing result-formatting"
 * item 293 itself calls for, rather than a second, possibly-drifting copy.
 */
export function predictionResultInfo(status: FixtureStatus, pointsAwarded: number | null): PredictionResultInfo {
  if (pointsAwarded !== null) {
    return pointsAwarded > 0
      ? { label: `Correct · +${pointsAwarded} pts`, className: "text-live", icon: CheckCircle2 }
      : { label: "Incorrect", className: "text-critical", icon: XCircle };
  }
  if (status === "finished") {
    return { label: "Not scored yet", className: "text-foreground-subtle", icon: Clock };
  }
  if (status === "postponed" || status === "cancelled" || status === "abandoned") {
    return { label: "No result", className: "text-foreground-subtle", icon: MinusCircle };
  }
  return { label: "Pending", className: "text-foreground-subtle", icon: Clock };
}
