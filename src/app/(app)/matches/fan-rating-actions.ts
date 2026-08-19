"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";

/**
 * RECOMMENDATIONS item 170: fan match ratings, explicitly opinion not a
 * data-provider rating. Real fixture-status gate mirrors submitPrediction's
 * own shape (predictions/actions.ts) — checked here for an honest error
 * message, with fan_ratings_insert_own's WITH CHECK (0032) enforcing the
 * same "must be finished" rule in RLS itself as the real backstop.
 */
export async function submitFanRating(fixtureId: string, rating: number) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Rating must be between 1 and 5." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to rate a match." };
  }

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "submit_fan_rating", 20, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { data: fixture, error: fixtureError } = await supabase
    .from("fixtures")
    .select("status")
    .eq("id", fixtureId)
    .maybeSingle();

  if (fixtureError || !fixture) {
    return { error: "That fixture no longer exists." };
  }
  if (fixture.status !== "finished") {
    return { error: "You can rate a match once it's finished." };
  }

  const { error } = await supabase
    .from("fan_ratings")
    .upsert({ profile_id: profile.id, fixture_id: fixtureId, rating }, { onConflict: "profile_id,fixture_id" });

  if (error) {
    logError("matches.fan-rating-actions.submitFanRating", error);
    return { error: "Couldn't save your rating. Try again." };
  }

  revalidatePath(`/matches/${fixtureId}`);
  return { error: null };
}
