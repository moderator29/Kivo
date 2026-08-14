"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge, awardXp } from "@/lib/rewards";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export async function completeOnboarding(formData: FormData) {
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
  const { error } = await supabase
    .from("profiles")
    .update({ username, onboarding_completed: true })
    .eq("id", profile.id);

  if (error) {
    if (error.code === "23505") {
      return { error: "That username is taken. Try another." };
    }
    console.error("Failed to complete onboarding", error);
    return { error: "Something went wrong. Try again." };
  }

  await Promise.all([awardXp(profile.id, 10, "Completed onboarding"), awardBadge(profile.id, "welcome")]);

  redirect("/home");
}

export async function skipOnboarding() {
  const profile = await getOrCreateProfile();
  if (!profile) return;

  const supabase = createServerSupabaseClient();
  await supabase.from("profiles").update({ onboarding_completed: true }).eq("id", profile.id);
  await Promise.all([awardXp(profile.id, 10, "Completed onboarding"), awardBadge(profile.id, "welcome")]);
  redirect("/home");
}
