"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";

// RECOMMENDATIONS item 173: "saves table mirroring follows" — same
// polymorphic shape, same toggle pattern as toggleFollow (follow-actions.ts)
// right down to the delete-if-currently/insert-otherwise branch and the
// rate-limit key naming.
export type SaveTargetType = "post" | "team" | "player";

export async function toggleSave(targetType: SaveTargetType, targetId: string, currentlySaved: boolean) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to save.", saved: currentlySaved };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "toggle_save", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error, saved: currentlySaved };

  const supabase = createServerSupabaseClient();

  const { error } = currentlySaved
    ? await supabase
        .from("saves")
        .delete()
        .eq("profile_id", profile.id)
        .eq("target_type", targetType)
        .eq("target_id", targetId)
    : await supabase.from("saves").insert({ profile_id: profile.id, target_type: targetType, target_id: targetId });

  if (error) {
    console.error("Failed to toggle save", error);
    return { error: "Couldn't update. Try again.", saved: currentlySaved };
  }

  // Only the pages that actually read save state: the Saved list itself,
  // and /social (a post's save state is shown inline on its card there).
  revalidatePath("/saved");
  if (targetType === "post") revalidatePath("/social");
  return { error: null, saved: !currentlySaved };
}
