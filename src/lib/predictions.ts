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
