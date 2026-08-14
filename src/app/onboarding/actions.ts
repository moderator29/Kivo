"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge, awardXp } from "@/lib/rewards";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

/**
 * Step 1 of 2. Only saves the username — `onboarding_completed` isn't set
 * here so a user who reloads mid-flow lands back on onboarding rather than
 * /home with no favourite team ever asked. finishOnboarding() below is what
 * actually completes the flow, after the optional team step.
 */
export async function saveUsernameStep(formData: FormData): Promise<{ error: string | null }> {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Username must be 3-24 characters: lowercase letters, numbers and underscores only." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in." };
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ username }).eq("id", profile.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is taken. Try another." };
    }
    console.error("Failed to save username", error);
    return { error: "Something went wrong. Try again." };
  }

  return { error: null };
}

/**
 * Step 2 of 2 (or the only step, when no teams are synced yet to offer a
 * picker for). `teamId` is optional by design — favourite_team_id is a
 * personalization anchor (src/lib/ai/grounding.ts), not a requirement.
 */
export async function finishOnboarding(teamId: string | null) {
  const profile = await getOrCreateProfile();
  if (!profile) {
    redirect("/sign-in");
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ favourite_team_id: teamId, onboarding_completed: true })
    .eq("id", profile.id);

  if (error) {
    console.error("Failed to finish onboarding", error);
  }

  await Promise.all([awardXp(profile.id, 10, "Completed onboarding"), awardBadge(profile.id, "welcome")]);

  redirect("/home");
}

/**
 * Bypasses the flow entirely (no username change, no favourite team) — so,
 * unlike finishOnboarding, this deliberately awards nothing: the "welcome"
 * badge reads "Completed onboarding and picked a KIVO handle", which skip
 * does neither of.
 */
export async function skipOnboarding() {
  const profile = await getOrCreateProfile();
  if (!profile) return;

  const supabase = createServerSupabaseClient();
  await supabase.from("profiles").update({ onboarding_completed: true }).eq("id", profile.id);
  redirect("/home");
}
