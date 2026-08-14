"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

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
