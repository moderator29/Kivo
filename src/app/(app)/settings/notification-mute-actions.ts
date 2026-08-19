"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import { getMyMutedTargets, type MuteTargetType } from "@/lib/notification-mutes";
import { logError } from "@/lib/log";

/**
 * The "this club, not that one" surface (migration 0104).
 *
 * KIVO already had a mute: `follows.muted`, the toggle next to the follow star.
 * It works, it stays, and it does not answer the question — because the two
 * entities a fan most wants to silence are precisely the two it cannot reach.
 * A **favourite club** has no `follows` row (it lives in
 * `profiles.favourite_team_id`), so the club a person cares most about was the
 * one club they could not turn down. And a **competition** has never had any
 * notification control at all.
 *
 * `notification_mutes` covers all three kinds, whether or not the entity is
 * followed. Both stores are honoured by the audience filter, so nothing that
 * was already muted becomes unmuted.
 */

export type EntityMuteResult = { error: string | null; muted: boolean };

/**
 * Unmuting clears BOTH stores, and that is the point of doing it here rather
 * than in two places.
 *
 * A followed club can be muted through the follow star (`follows.muted`) and
 * shown as muted on this page. If unmuting only deleted the
 * `notification_mutes` row, the switch would flick to "on" and the user would
 * still hear nothing, because the follow-star mute was still set — a control
 * that reports a state it did not achieve. Muting only ever writes the new
 * store, so the follow star keeps its own meaning.
 */
export async function setEntityMuted(
  targetType: MuteTargetType,
  targetId: string,
  muted: boolean,
): Promise<EntityMuteResult> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to change this.", muted: !muted };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "toggle_follow_mute", 20, 60);
  if (!rateLimit.ok) return { error: rateLimit.error, muted: !muted };

  const supabase = createServerSupabaseClient();

  if (muted) {
    const { error } = await supabase
      .from("notification_mutes")
      .upsert(
        { profile_id: profile.id, target_type: targetType, target_id: targetId },
        { onConflict: "profile_id,target_type,target_id", ignoreDuplicates: true },
      );
    if (error) {
      logError("settings.notification-mute-actions.mute", error);
      return { error: "Couldn't mute that. Try again.", muted: false };
    }
  } else {
    const { error } = await supabase
      .from("notification_mutes")
      .delete()
      .eq("profile_id", profile.id)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    if (error) {
      logError("settings.notification-mute-actions.unmute", error);
      return { error: "Couldn't unmute that. Try again.", muted: true };
    }

    // The other store. No error branch that fails the whole action: a user with
    // no follow row for this entity is the normal case (a favourite club, an
    // unfollowed competition), and matching zero rows is success, not failure.
    const { error: followError } = await supabase
      .from("follows")
      .update({ muted: false })
      .eq("follower_profile_id", profile.id)
      .eq("followed_type", targetType)
      .eq("followed_id", targetId)
      .eq("muted", true);
    if (followError) logError("settings.notification-mute-actions.clearFollowMute", followError);
  }

  revalidatePath("/settings/notifications");
  revalidatePath("/profile/following");
  return { error: null, muted };
}

export type NotifiableEntity = {
  type: MuteTargetType;
  id: string;
  name: string;
  /** Why this entity can notify them at all — shown so the list never looks
   * arbitrary. */
  reason: string;
  muted: boolean;
};

/**
 * Exactly the entities that can currently produce a notification for this
 * person: their favourite club, the teams and players they follow, and the
 * competitions they follow.
 *
 * Deliberately not "every club in the database with a search box". A mute list
 * is only useful if it is the list of things actually making noise — and
 * KIVO's producers build their audience from precisely these four sources, so
 * anything else on this page would be a switch that does nothing.
 */
export async function getNotifiableEntities(): Promise<NotifiableEntity[]> {
  const profile = await getOrCreateProfile();
  if (!profile) return [];

  const supabase = createServerSupabaseClient();

  const [{ data: me }, { data: follows }, mutedTargets] = await Promise.all([
    supabase.from("profiles").select("favourite_team_id").eq("id", profile.id).maybeSingle(),
    supabase
      .from("follows")
      .select("followed_type, followed_id, muted")
      .eq("follower_profile_id", profile.id)
      .in("followed_type", ["team", "player", "competition"]),
    getMyMutedTargets(supabase, profile.id),
  ]);

  const explicitlyMuted = new Set(mutedTargets.map((target) => `${target.type}:${target.id}`));
  const followMuted = new Set(
    (follows ?? []).filter((row) => row.muted).map((row) => `${row.followed_type}:${row.followed_id}`),
  );

  const teamIds = new Set<string>();
  const playerIds = new Set<string>();
  const competitionIds = new Set<string>();
  if (me?.favourite_team_id) teamIds.add(me.favourite_team_id);
  for (const row of follows ?? []) {
    if (row.followed_type === "team") teamIds.add(row.followed_id);
    if (row.followed_type === "player") playerIds.add(row.followed_id);
    if (row.followed_type === "competition") competitionIds.add(row.followed_id);
  }

  const [{ data: teams }, { data: players }, { data: competitions }] = await Promise.all([
    teamIds.size > 0
      ? supabase.from("teams").select("id, name").in("id", [...teamIds])
      : Promise.resolve({ data: [] }),
    playerIds.size > 0
      ? supabase.from("players").select("id, full_name, known_as").in("id", [...playerIds])
      : Promise.resolve({ data: [] }),
    competitionIds.size > 0
      ? supabase.from("competitions").select("id, name").in("id", [...competitionIds])
      : Promise.resolve({ data: [] }),
  ]);

  const isMuted = (type: MuteTargetType, id: string) =>
    explicitlyMuted.has(`${type}:${id}`) || followMuted.has(`${type}:${id}`);

  const entities: NotifiableEntity[] = [];

  for (const team of teams ?? []) {
    entities.push({
      type: "team",
      id: team.id,
      name: team.name,
      reason: team.id === me?.favourite_team_id ? "Your club" : "Following",
      muted: isMuted("team", team.id),
    });
  }
  for (const player of players ?? []) {
    entities.push({
      type: "player",
      id: player.id,
      name: player.known_as || player.full_name,
      reason: "Following",
      muted: isMuted("player", player.id),
    });
  }
  for (const competition of competitions ?? []) {
    entities.push({
      type: "competition",
      id: competition.id,
      name: competition.name,
      reason: "Following",
      muted: isMuted("competition", competition.id),
    });
  }

  return entities;
}
