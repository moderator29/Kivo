"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { awardXp, awardBadge } from "@/lib/rewards";
import { logAudit } from "@/lib/audit";
import { CORRECT_PREDICTION_POINTS, CORRECT_PREDICTION_XP } from "@/lib/predictions";

type PredictionOutcome = "home_win" | "draw" | "away_win";

function realOutcome(homeScore: number, awayScore: number): PredictionOutcome {
  if (homeScore > awayScore) return "home_win";
  if (awayScore > homeScore) return "away_win";
  return "draw";
}

/**
 * On-demand admin pass, same shape as the football syncs on this page: no
 * cron, an admin triggers it, it processes what's real and reports what it
 * did. Scores every not-yet-scored prediction against real, already-synced
 * fixture results (`fixtures.status = 'finished'` with real home_score/
 * away_score, never a guessed or fabricated result), writes `points_awarded`
 * and `locked_at`, and awards XP for correct picks via the shared ledger
 * helper. Runs under the service-role client because it writes points onto
 * other users' rows, which `predictions_update_own_unlocked` (correctly)
 * never allows a plain client to do.
 */
export async function scorePredictions(): Promise<{ error: string | null; recordsProcessed?: number }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const supabase = createServerSupabaseClient();
  const { data: finishedFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, home_score, away_score")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null);

  if (fixturesError) {
    console.error("Failed to load finished fixtures for scoring", fixturesError);
    return { error: "Couldn't load finished fixtures. Try again." };
  }

  const scoredFixtures = finishedFixtures ?? [];
  if (scoredFixtures.length === 0) {
    return { error: null, recordsProcessed: 0 };
  }

  const outcomeByFixture = new Map(
    scoredFixtures.map((f) => [f.id, realOutcome(f.home_score as number, f.away_score as number)]),
  );
  const fixtureIds = scoredFixtures.map((f) => f.id);

  const service = createServiceRoleSupabaseClient();
  const { data: unscored, error: predictionsError } = await service
    .from("predictions")
    .select("id, profile_id, fixture_id, predicted_outcome")
    .in("fixture_id", fixtureIds)
    .is("points_awarded", null);

  if (predictionsError) {
    console.error("Failed to load unscored predictions", predictionsError);
    return { error: "Couldn't load predictions to score. Try again." };
  }

  const rows = unscored ?? [];
  if (rows.length === 0) {
    return { error: null, recordsProcessed: 0 };
  }

  const now = new Date().toISOString();
  let processed = 0;

  for (const row of rows) {
    const outcome = outcomeByFixture.get(row.fixture_id);
    if (!outcome) continue;

    const correct = row.predicted_outcome === outcome;
    const points = correct ? CORRECT_PREDICTION_POINTS : 0;

    const { error: updateError } = await service
      .from("predictions")
      .update({ points_awarded: points, locked_at: now })
      .eq("id", row.id);

    if (updateError) {
      console.error(`Failed to score prediction ${row.id}`, updateError);
      continue;
    }

    processed += 1;
    if (correct) {
      await awardXp(row.profile_id, CORRECT_PREDICTION_XP, "Correct match prediction");
      await awardBadge(row.profile_id, "first_prediction_correct");

      // Real running total, not a guessed streak — counts this user's
      // actually-scored correct predictions straight from the predictions
      // table (points_awarded is only ever set by this same scoring pass).
      const { count: correctCount } = await service
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", row.profile_id)
        .gt("points_awarded", 0);
      if ((correctCount ?? 0) >= 5) {
        await awardBadge(row.profile_id, "five_predictions_correct");
      }
    }
  }

  await logAudit(profile.id, "score_predictions", "predictions", {
    fixturesConsidered: scoredFixtures.length,
    recordsProcessed: processed,
  });

  revalidatePath("/predictions");
  revalidatePath("/admin/data-health");

  return { error: null, recordsProcessed: processed };
}
