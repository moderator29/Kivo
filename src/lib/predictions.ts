// Shared between the admin scoring action and the Data Health page's copy —
// a "use server" file may only export async functions, so these live here
// rather than alongside scorePredictions() in predictions-actions.ts.
export const CORRECT_PREDICTION_POINTS = 3;
export const CORRECT_PREDICTION_XP = 15;
