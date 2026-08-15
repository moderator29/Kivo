"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { awardBadge } from "@/lib/rewards";

type FollowTargetType = "team" | "player" | "competition";

// Maps a follow target to the one detail page that shows its own follow
// state (RECOMMENDATIONS item 81) — "competition" rows live under /leagues,
// not /competitions, matching leagues/[id]/page.tsx's route.
const TARGET_DETAIL_PATH: Record<FollowTargetType, string> = {
  team: "/teams",
  player: "/players",
  competition: "/leagues",
};

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

  // Only the pages that actually read follow state: the target's own detail
  // page, and the two profile surfaces that show follow counts/lists. Was
  // revalidatePath("/", "layout"), which dropped the entire app's cache for
  // one like or one follow (RECOMMENDATIONS item 81).
  revalidatePath(`${TARGET_DETAIL_PATH[targetType]}/${targetId}`);
  revalidatePath("/profile");
  revalidatePath("/profile/following");
  return { error: null, following: !currentlyFollowing };
}
