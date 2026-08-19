import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

/**
 * Per-entity notification mutes — the "this club, not that one" half of the
 * founding brief's notification section (migration 0104).
 *
 * KIVO had exactly one switch for all nine match notification types
 * (`match_alerts_enabled`) plus `follows.muted`, a per-follow toggle. That left
 * a fan unable to silence the one club they care most about — a favourite club
 * reaches `teamAudience` through `profiles.favourite_team_id`, which has no
 * mute — and unable to say anything at all about competitions, despite
 * `follows` carrying `followed_type = 'competition'` since 0001 with no
 * producer ever reading it.
 *
 * The rule this module implements, stated once so every producer applies the
 * same one:
 *
 *   A recipient is dropped from a notification if they have muted the entity
 *   that put them in its audience, OR the competition the fixture belongs to.
 *
 * The first clause is why filtering happens per audience rather than over the
 * union. Someone who follows both clubs in a derby and has muted one of them
 * still wants the derby — they are in the audience twice and only one reason
 * was silenced. Filtering the union would take the notification away from them.
 */

export type MuteTargetType = "team" | "player" | "competition";

export type MuteTarget = { type: MuteTargetType; id: string };

type Client = SupabaseClient<Database>;

/** Same chunk size as `filterNotifiable`, and for the same reason: the ids
 * travel in a URL-encoded PostgREST `in.(...)` filter and an audience is
 * unbounded by nature. */
const MUTE_LOOKUP_CHUNK_SIZE = 300;

function key(type: string, id: string): string {
  return `${type}:${id}`;
}

/**
 * Returns the ids from `profileIds` that have muted NONE of `targets`, in input
 * order.
 *
 * `follows.muted` is honoured too, and deliberately so. It is the follow-star
 * toggle and it belongs to that surface; reading only `notification_mutes`
 * would silently un-mute every entity a user has already turned off there. A
 * mute from either source is a mute — the union is the honest reading, and it
 * can only ever remove people from an audience, never add them.
 *
 * Fails OPEN, unlike `filterNotifiable`, and the asymmetry is intentional. An
 * unreadable *preference* is not consent, so that one fails closed. An
 * unreadable *mute* is a transient database error on a filter that only ever
 * subtracts, and failing closed there would silence every notification for
 * everybody for the duration of the fault — a far worse outcome than one
 * notification arriving that a user had asked not to see. Logged either way.
 */
export async function filterOutMuted(
  supabase: Client,
  profileIds: Iterable<string>,
  targets: MuteTarget[],
): Promise<string[]> {
  const ids = Array.from(new Set(profileIds));
  if (ids.length === 0 || targets.length === 0) return ids;

  const wanted = new Set(targets.map((target) => key(target.type, target.id)));
  const targetIds = Array.from(new Set(targets.map((target) => target.id)));

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MUTE_LOOKUP_CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + MUTE_LOOKUP_CHUNK_SIZE));
  }

  const muted = new Set<string>();
  await Promise.all(
    chunks.map(async (chunk) => {
      const [explicit, followMutes] = await Promise.all([
        supabase
          .from("notification_mutes")
          .select("profile_id, target_type, target_id")
          .in("profile_id", chunk)
          .in("target_id", targetIds),
        supabase
          .from("follows")
          .select("follower_profile_id, followed_type, followed_id")
          .in("follower_profile_id", chunk)
          .in("followed_id", targetIds)
          .eq("muted", true),
      ]);

      if (explicit.error) logError("notification-mutes.explicitMuteLookup", explicit.error);
      if (followMutes.error) logError("notification-mutes.followMuteLookup", followMutes.error);

      // `in("target_id", ...)` cannot express the (type, id) pair, so the type
      // is matched here. Without it, a competition whose id happened to equal a
      // team id would cross-mute — impossible with uuids in practice, and not
      // something to leave depending on that.
      for (const row of explicit.data ?? []) {
        if (wanted.has(key(row.target_type, row.target_id))) muted.add(row.profile_id);
      }
      for (const row of followMutes.data ?? []) {
        if (wanted.has(key(row.followed_type, row.followed_id))) muted.add(row.follower_profile_id);
      }
    }),
  );

  return ids.filter((id) => !muted.has(id));
}

/**
 * The caller's own mutes, for rendering Settings. Uses the caller's session
 * client, not the service role — `notification_mutes_select_own` scopes it.
 */
export async function getMyMutedTargets(supabase: Client, profileId: string): Promise<MuteTarget[]> {
  const { data, error } = await supabase
    .from("notification_mutes")
    .select("target_type, target_id")
    .eq("profile_id", profileId);

  if (error) {
    logError("notification-mutes.getMyMutedTargets", error);
    return [];
  }

  return (data ?? [])
    .filter((row): row is typeof row & { target_type: MuteTargetType } => row.target_type !== "user")
    .map((row) => ({ type: row.target_type, id: row.target_id }));
}
