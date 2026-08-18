import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getViewerFantasyRosterBySeasons } from "@/lib/football/fantasy-lineup-crossref";
import type { NotificationRow } from "@/lib/notifications";
import { logError } from "@/lib/log";

type ServerClient = SupabaseClient<Database>;

/** What a match notification turns out to be about, for this reader
 * specifically. `isCaptain` is the stronger of the two facts and is the only
 * reason the distinction is worth two states rather than one. */
export type NotificationFantasyContext = { isCaptain: boolean };

/** notification id -> the viewer's own fantasy relationship to it. Only ever
 * contains entries for notifications that really do name a player in the
 * viewer's current starting XI. */
export type NotificationFantasyMap = Map<string, NotificationFantasyContext>;

/**
 * KN-45: a goal scored by your own captain should not read identically to a
 * goal scored by somebody you have never heard of.
 *
 * The two halves of this already existed and had never been introduced:
 * `notifications.payload` carries `player_id` for `match_goal`,
 * `match_red_card` and `player_event` (see notification-payloads.ts), and
 * `getViewerFantasyRosterBySeasons` already answers "is this player in the
 * viewer's XI" for Match Centre and /live. This joins them.
 *
 * Deliberately at **read** time, not at write time, for three reasons:
 *
 *  1. It is a fact about the *reader*, and a notification row is shared by
 *     nobody — but stamping it at write time would freeze it. Squads change
 *     every gameweek; "your captain scored this" would still be claiming a
 *     captaincy the user transferred out three weeks later.
 *  2. The producers run inside a sync, where they already fan out over an
 *     audience. Adding a per-recipient fantasy lookup there would put a
 *     per-follower query chain in the hot path of a live match.
 *  3. Nothing is written, so nothing can be wrong later. This is a decoration
 *     computed from current truth, and if the user's squad changes the
 *     decoration changes with it.
 *
 * Best-effort by construction: on any failure it returns an empty map, and
 * every notification renders exactly as it did before. Bounded by the page of
 * notifications on screen (30 rows), not by the user's whole history.
 */
export async function getNotificationFantasyContext(
  supabase: ServerClient,
  profileId: string,
  notifications: Pick<NotificationRow, "id" | "type" | "payload">[],
): Promise<NotificationFantasyMap> {
  const result: NotificationFantasyMap = new Map();

  // Only the three types whose payload names a player at all.
  const candidates: { notificationId: string; fixtureId: string; playerId: string }[] = [];
  for (const notification of notifications) {
    if (
      notification.type !== "match_goal" &&
      notification.type !== "match_red_card" &&
      notification.type !== "player_event"
    ) {
      continue;
    }
    const payload = (notification.payload ?? {}) as Record<string, unknown>;
    const fixtureId = typeof payload.fixture_id === "string" ? payload.fixture_id : null;
    const playerId = typeof payload.player_id === "string" ? payload.player_id : null;
    // `player_id` is legitimately null on a goal whose scorer the provider
    // never named — those simply cannot be cross-referenced, which is not a
    // failure, just an absence.
    if (!fixtureId || !playerId) continue;
    candidates.push({ notificationId: notification.id, fixtureId, playerId });
  }

  if (candidates.length === 0) return result;

  try {
    // A fixture's season is what the roster lookup keys on, and the payload
    // does not carry it — one batched read over the fixtures actually named on
    // this page.
    const fixtureIds = [...new Set(candidates.map((c) => c.fixtureId))];
    const { data: fixtures, error } = await supabase
      .from("fixtures")
      .select("id, season_id")
      .in("id", fixtureIds);
    if (error) {
      logError("notificationFantasyContext.fixtures", error, { count: fixtureIds.length });
      return result;
    }

    const seasonByFixtureId = new Map((fixtures ?? []).map((f) => [f.id, f.season_id]));
    const seasonIds = [...new Set([...seasonByFixtureId.values()])];
    if (seasonIds.length === 0) return result;

    const rosterBySeason = await getViewerFantasyRosterBySeasons(supabase, profileId, seasonIds);
    if (rosterBySeason.size === 0) return result;

    for (const candidate of candidates) {
      const seasonId = seasonByFixtureId.get(candidate.fixtureId);
      if (!seasonId) continue;
      const flags = rosterBySeason.get(seasonId)?.get(candidate.playerId);
      if (!flags) continue;
      result.set(candidate.notificationId, { isCaptain: flags.isCaptain });
    }
  } catch (error) {
    logError("notificationFantasyContext.failed", error, {});
    return new Map();
  }

  return result;
}
