"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { awardBadge } from "@/lib/rewards";

// RECOMMENDATIONS item 175: "user" was already in the follow_target_type
// enum (0001) and follows_no_self_follow already guards it — nothing
// client-facing used it until now. Following a user has no dedicated
// "detail page follow state" the way team/player/competition do (see
// TARGET_DETAIL_PATH below, which deliberately doesn't cover "user"), so a
// user follow instead feeds the /social Following tab.
type FollowTargetType = "team" | "player" | "competition" | "user";

// Maps a follow target to the one detail page that shows its own follow
// state (RECOMMENDATIONS item 81) — "competition" rows live under /leagues,
// not /competitions, matching leagues/[id]/page.tsx's route. "user" has no
// entry: /u/[username] is keyed by username, not the profile id this
// function receives, and its own follow state is re-fetched by the page
// itself rather than needing a targeted revalidate here.
const TARGET_DETAIL_PATH: Partial<Record<FollowTargetType, string>> = {
  team: "/teams",
  player: "/players",
  competition: "/leagues",
};

/**
 * Audit item 9: `new_follower` was fully registered in notification-registry.ts
 * (icon, copy, href) but had no producer anywhere — a repo-wide grep for
 * `.from("notifications").insert` only ever found match-notifications.ts and
 * social/actions.ts's notifyPostLiked. Mirrors notifyPostLiked's pattern
 * exactly: notifications has no client-facing insert policy by design
 * (system-generated only), so this goes through the service-role client
 * deliberately, not as an RLS workaround. No self-notify guard needed —
 * follows_no_self_follow (migration 0001) already makes self-follow
 * impossible at the DB layer.
 */
async function notifyNewFollower(followedProfileId: string, follower: { username: string; display_name: string | null }) {
  const serviceClient = createServiceRoleSupabaseClient();
  const { error } = await serviceClient.from("notifications").insert({
    profile_id: followedProfileId,
    type: "new_follower",
    payload: {
      follower_username: follower.username,
      follower_display_name: follower.display_name,
    },
  });
  if (error) console.error("Failed to create new-follower notification", error);
}

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
    // Only "user" follows have a person on the other end to notify — a team,
    // player, or competition doesn't have a notifications row to receive one.
    if (targetType === "user") {
      await notifyNewFollower(targetId, profile);
    }
  }

  // Only the pages that actually read follow state: the target's own detail
  // page, and the two profile surfaces that show follow counts/lists. Was
  // revalidatePath("/", "layout"), which dropped the entire app's cache for
  // one like or one follow (RECOMMENDATIONS item 81).
  const detailPath = TARGET_DETAIL_PATH[targetType];
  if (detailPath) revalidatePath(`${detailPath}/${targetId}`);
  // "user" follows feed the /social Following tab (item 175) instead of a
  // target detail page.
  if (targetType === "user") revalidatePath("/social");
  revalidatePath("/profile");
  revalidatePath("/profile/following");
  return { error: null, following: !currentlyFollowing };
}
