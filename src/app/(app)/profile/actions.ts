"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

/**
 * Debounced as-you-type availability check backing UsernameEditor's inline
 * indicator — lets a user find out their new handle is taken before they
 * submit, instead of only from updateUsername's 23505 branch below after a
 * round trip. Same `is_username_available` SECURITY DEFINER RPC as
 * onboarding's checkUsername (src/app/onboarding/actions.ts): profiles has
 * no cross-user SELECT policy, so this can't be a plain client query.
 * p_exclude_profile_id is the caller's own id so re-typing their current
 * username correctly reports "available" rather than "taken by you".
 */
export async function checkUsernameAvailable(username: string): Promise<{ available: boolean | null }> {
  const trimmed = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(trimmed)) {
    return { available: null };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { available: null };
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("is_username_available", {
    p_username: trimmed,
    p_exclude_profile_id: profile.id,
  });

  if (error) {
    console.error("Failed to check username availability", error);
    return { available: null };
  }

  return { available: data };
}

export async function updateUsername(formData: FormData) {
  const username = String(formData.get("username") ?? "")
    .trim()
    .toLowerCase();

  if (!USERNAME_PATTERN.test(username)) {
    return { error: "Username must be 3-24 characters: lowercase letters, numbers and underscores only." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ username }).eq("id", profile.id);

  if (error) {
    if (error.code === "23505") return { error: "That username is taken. Try another." };
    console.error("Failed to update username", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/profile");
  return { error: null };
}
