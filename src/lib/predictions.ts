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
