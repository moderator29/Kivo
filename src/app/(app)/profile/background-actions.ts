"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { isKivoBackgroundId } from "@/lib/kivo-assets";

export async function selectBackground(backgroundId: string) {
  if (!isKivoBackgroundId(backgroundId)) {
    return { error: "That's not a KIVO background." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ background_id: backgroundId }).eq("id", profile.id);

  if (error) {
    logError("profile.background-actions.selectBackground", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}

/** No default background is ever forced (this feature's own spec) — this is
 * the explicit "go back to having none" action, distinct from selecting one
 * of the ten real ids. */
export async function clearBackground() {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("profiles").update({ background_id: null }).eq("id", profile.id);

  if (error) {
    logError("profile.background-actions.clearBackground", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}
