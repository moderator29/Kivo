"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { awardBadge } from "@/lib/rewards";

type FollowTargetType = "team" | "player" | "competition";

export async function toggleFollow(targetType: FollowTargetType, targetId: string, currentlyFollowing: boolean) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to follow.", following: currentlyFollowing };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "toggle_follow", 20, 60);
  if (!rateLimit.ok) return { error: rateLimit.error, following: currentlyFollowing };

  const supabase = createServerSupabaseClient();

  const { error } = currentlyFollowing
    ? await supabase
        .from("follows")
        .delete()
        .eq("follower_profile_id", profile.id)
        .eq("followed_type", targetType)
        .eq("followed_id", targetId)
    : await supabase.from("follows").insert({
        follower_profile_id: profile.id,
        followed_type: targetType,
        followed_id: targetId,
      });

  if (error) {
    console.error("Failed to toggle follow", error);
    return { error: "Couldn't update. Try again.", following: currentlyFollowing };
  }

  // Only on a real new follow (not an unfollow) — !currentlyFollowing here
  // means the branch above just inserted a row.
  if (!currentlyFollowing) {
    await awardBadge(profile.id, "first_follow");
    const { count: followCount } = await supabase
      .from("follows")
      .select("id", { count: "exact", head: true })
      .eq("follower_profile_id", profile.id);
    if ((followCount ?? 0) >= 5) {
      await awardBadge(profile.id, "five_follows");
    }
  }

  revalidatePath("/", "layout");
  return { error: null, following: !currentlyFollowing };
}
