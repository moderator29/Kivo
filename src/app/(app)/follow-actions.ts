"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { awardBadge } from "@/lib/rewards";
import { shouldNotify } from "@/lib/notification-preferences";
import { buildNotification } from "@/lib/notification-payloads";

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

  // RECOMMENDATIONS.md item 285: gate before writing, not after.
  if (!(await shouldNotify(serviceClient, followedProfileId, "social_alerts_enabled"))) return;

  // KN-90: built through the typed constructor rather than an object literal,
  // so a missing or renamed payload field is a type error here instead of a
  // notification that renders fine and links nowhere.
  const { error } = await serviceClient.from("notifications").insert(
    buildNotification(followedProfileId, "new_follower", {
      follower_username: follower.username,
      follower_display_name: follower.display_name,
    }),
  );
  if (error) logError("follow-actions.createNewFollowerNotification", error);
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
    logError("follow-actions.toggleFollow", error);
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

/**
 * RECOMMENDATIONS.md item 287: per-team/per-player mute, modeled on `follows`
 * itself rather than `notification_preferences` — see the migration's own
 * comment for why the latter can't hold this (a flat one-row-per-profile
 * table with no per-entity dimension). Only "team"/"player" carry a mute
 * toggle in the UI (the follow star's new sibling on teams/[id]/page.tsx and
 * players/[id]/page.tsx) because those are the only two audiences
 * match-notifications.ts's teamAudience()/playerAudience() actually build —
 * there's no competition or user audience builder for a mute to exclude rows
 * from. Only meaningful once item 285 wires notification_preferences into
 * the producers: muting one followed team/player silences exactly the same
 * match notifications item 285 gates, on top of (not instead of) the global
 * match_alerts_enabled toggle.
 */
export async function toggleFollowMute(targetType: "team" | "player", targetId: string, currentlyMuted: boolean) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to mute.", muted: currentlyMuted };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "toggle_follow_mute", 20, 60);
  if (!rateLimit.ok) return { error: rateLimit.error, muted: currentlyMuted };

  const supabase = createServerSupabaseClient();
  // Update, not delete+insert (unlike toggleFollow above) — muting must never
  // disturb the follow row itself, only flip its one new column in place.
  // .select().maybeSingle() doubles as the "were they actually following
  // this?" check: zero rows matched the .eq()s below updates nothing and
  // returns null, rather than erroring.
  const { data, error } = await supabase
    .from("follows")
    .update({ muted: !currentlyMuted })
    .eq("follower_profile_id", profile.id)
    .eq("followed_type", targetType)
    .eq("followed_id", targetId)
    .select("muted")
    .maybeSingle();

  if (error) {
    logError("follow-actions.toggleFollowMute", error);
    return { error: "Couldn't update. Try again.", muted: currentlyMuted };
  }
  if (!data) {
    return { error: "Follow this to mute its notifications.", muted: currentlyMuted };
  }

  const detailPath = TARGET_DETAIL_PATH[targetType];
  if (detailPath) revalidatePath(`${detailPath}/${targetId}`);
  return { error: null, muted: data.muted };
}
