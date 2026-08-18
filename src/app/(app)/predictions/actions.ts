"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import type { PredictionOutcome } from "@/lib/predictions";

/**
 * No cron/live-polling job exists to flip `locked_at` at kickoff (see
 * FOOTBALL_LIVE_POLLING_ENABLED) — so kickoff-has-passed is enforced here,
 * against the fixture's real synced kickoff_at, rather than relying on a
 * column nothing populates yet. RLS's `locked_at is null` check still applies
 * underneath this as a second layer once that automation exists.
 */
export async function submitPrediction(fixtureId: string, outcome: PredictionOutcome) {
  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to predict." };
  }

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "submit_prediction", 20, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { data: fixture, error: fixtureError } = await supabase
    .from("fixtures")
    .select("kickoff_at, status")
    .eq("id", fixtureId)
    .maybeSingle();

  if (fixtureError || !fixture) {
    return { error: "That fixture no longer exists." };
  }
  if (fixture.status !== "scheduled" || new Date(fixture.kickoff_at) <= new Date()) {
    return { error: "Predictions lock at kickoff. This match has already started." };
  }

  const { error } = await supabase
    .from("predictions")
    .upsert(
      { profile_id: profile.id, fixture_id: fixtureId, predicted_outcome: outcome },
      { onConflict: "profile_id,fixture_id" },
    );

  if (error) {
    logError("predictions.submitPrediction", error);
    return { error: "Couldn't save your prediction. Try again." };
  }

  revalidatePath("/predictions");
  return { error: null };
}
