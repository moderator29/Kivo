"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";

/**
 * Self-service block and unblock (migration 0086).
 *
 * Both actions are deliberately thin. Everything that decides what a block
 * *means* lives in the database: `blocks_insert_own` / `blocks_delete_own`
 * scope the write to the caller, `blocks_not_self` rejects the degenerate
 * case, the read filters on `posts` and `comments` do the hiding, and
 * `trg_blocks_sever_follows` unwinds the follow graph in both directions. A
 * server action that forgot any of that would still be safe, which is the
 * property worth having.
 *
 * Mirrors follow-actions.ts's shape exactly — same rate-limit bucket
 * convention, same revalidate-and-return-error contract — because a block is
 * the same kind of relationship write as a follow, and a reviewer should not
 * have to learn a second pattern to check it.
 */

export async function blockUser(targetProfileId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to block someone." };
  if (profile.id === targetProfileId) return { error: "You can't block yourself." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "block_user", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("blocks")
    .upsert(
      { blocker_profile_id: profile.id, blocked_profile_id: targetProfileId },
      // Blocking twice is not an error — it is the state the user asked for,
      // and reporting a failure would be confusing for something already true.
      { onConflict: "blocker_profile_id,blocked_profile_id", ignoreDuplicates: true },
    );

  if (error) {
    logError("blocks.blockUser", error);
    return { error: "Couldn't block that account. Try again." };
  }

  // Their posts and comments have just left every list this viewer can see,
  // so every list this viewer might be looking at needs rebuilding.
  revalidatePath("/social");
  revalidatePath("/notifications");
  revalidatePath("/settings/privacy");
  return { error: null };
}

export async function unblockUser(targetProfileId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to do that." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "block_user", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_profile_id", profile.id)
    .eq("blocked_profile_id", targetProfileId);

  if (error) {
    logError("blocks.unblockUser", error);
    return { error: "Couldn't unblock that account. Try again." };
  }

  // Deliberately does NOT restore the follows the block severed. A block is a
  // decision to walk away; unblocking is a decision to be able to see them
  // again, not a decision to re-follow them, and quietly recreating a
  // relationship the user ended would be KIVO acting on their behalf.
  revalidatePath("/social");
  revalidatePath("/settings/privacy");
  return { error: null };
}
