import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { EVENT_LABEL, isGoalEventType, isRedCardEventType } from "./event-labels";

/**
 * Real in-app notification producers, wired directly into the sync code
 * paths that already write the real row each one reacts to — no new
 * detection mechanism, no polling, no timer. `notifyFixtureStatusChange` is
 * called from `upsertFixture` (sync.ts) right after a fixture's status
 * actually changes in the DB; `notifyFixtureEvent` is called from
 * `upsertFixtureEvent` (sync-match-details.ts) right after a genuinely new
 * `fixture_events` row is inserted (never on the update/dedupe branch, so a
 * re-run of the same sync never re-notifies for an event it already wrote).
 *
 * Push notifications are explicitly out of scope (no push infra/service
 * worker exists — see BUILD_STATUS.md) — every producer here only ever
 * writes an in-app `notifications` row, same table/shape `notifyPostLiked`
 * (src/app/(app)/social/actions.ts) already writes for likes.
 *
 * Audience for every producer is real, queryable KIVO state: a team's
 * audience is profiles.favourite_team_id plus `follows` rows
 * (followed_type='team'); a player's audience is `follows` rows
 * (followed_type='player'). No "trending"/guessed audience anywhere.
 */

type ServiceClient = SupabaseClient<Database>;
type NotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];
type DbFixtureStatus = Database["public"]["Enums"]["fixture_status"];
type DbFixtureEventType = Database["public"]["Enums"]["fixture_event_type"];

async function teamAudience(supabase: ServiceClient, teamId: string): Promise<Set<string>> {
  const [{ data: favourites }, { data: followers }] = await Promise.all([
    supabase.from("profiles").select("id").eq("favourite_team_id", teamId),
    supabase.from("follows").select("follower_profile_id").eq("followed_type", "team").eq("followed_id", teamId),
  ]);
  const ids = new Set<string>();
  for (const row of favourites ?? []) ids.add(row.id);
  for (const row of followers ?? []) ids.add(row.follower_profile_id);
  return ids;
}

async function playerAudience(supabase: ServiceClient, playerId: string): Promise<Set<string>> {
  const { data: followers } = await supabase
    .from("follows")
    .select("follower_profile_id")
    .eq("followed_type", "player")
    .eq("followed_id", playerId);
  return new Set((followers ?? []).map((row) => row.follower_profile_id));
}

async function insertNotifications(
  supabase: ServiceClient,
  profileIds: Iterable<string>,
  build: (profileId: string) => NotificationInsert,
): Promise<void> {
  const rows = Array.from(profileIds, build);
  if (rows.length === 0) return;
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) console.error("match-notifications: failed to insert notification batch", error);
}

export interface FixtureStatusChangeInput {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  /** The fixture's real status in KIVO's DB before this sync run wrote the
   * new one — null when this is the first time KIVO has ever synced this
   * fixture (no prior state to diff against). */
  previousStatus: DbFixtureStatus | null;
  newStatus: DbFixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
}

/**
 * Kickoff / full-time notifications. Only fires on a real, KIVO-observed
 * transition (`previousStatus` known and different from `newStatus`) — never
 * on the first sync of an already-live/finished fixture, where "it just
 * happened" would be a guess dressed up as a fact.
 */
export async function notifyFixtureStatusChange(
  supabase: ServiceClient,
  input: FixtureStatusChangeInput,
): Promise<void> {
  if (!input.previousStatus || input.previousStatus === input.newStatus) return;

  let type: "match_kickoff" | "match_result" | null = null;
  let summary: string | null = null;

  if (input.newStatus === "live" && input.previousStatus !== "live") {
    type = "match_kickoff";
    summary = `${input.homeTeamName} vs ${input.awayTeamName} has kicked off`;
  } else if (input.newStatus === "finished" && input.previousStatus !== "finished") {
    type = "match_result";
    const score =
      input.homeScore !== null && input.awayScore !== null ? ` ${input.homeScore}-${input.awayScore}` : "";
    summary = `Full time: ${input.homeTeamName}${score} ${input.awayTeamName}`;
  }

  if (!type || !summary) return;

  const [homeAudience, awayAudience] = await Promise.all([
    teamAudience(supabase, input.homeTeamId),
    teamAudience(supabase, input.awayTeamId),
  ]);
  const audience = new Set<string>([...homeAudience, ...awayAudience]);
  const finalType = type;
  const finalSummary = summary;

  await insertNotifications(supabase, audience, (profileId) => ({
    profile_id: profileId,
    type: finalType,
    payload: { fixture_id: input.fixtureId, summary: finalSummary },
  }));
}

export interface FixtureEventNotificationInput {
  fixtureId: string;
  teamId: string;
  teamName: string;
  opponentName: string;
  eventType: DbFixtureEventType;
  minute: number;
  playerId: string | null;
  playerName: string | null;
}

/**
 * Goal / red card / "a followed player was involved" notifications, all off
 * one real `fixture_events` insert. Goals and red cards notify the scoring/
 * carded team's audience (favourite + followers) AND the player's own
 * followers (deduped so a user who both favourites the team and follows the
 * player gets one row, not two). Every other real event type
 * (yellow card, substitution, VAR review, own goal, penalty missed) only
 * notifies the involved player's followers — not the whole team's audience —
 * so a routine yellow card doesn't page everyone who merely favourites the
 * club; this is what covers "a favourite player involved in an event" for
 * event types beyond goals/red cards.
 */
export async function notifyFixtureEvent(
  supabase: ServiceClient,
  input: FixtureEventNotificationInput,
): Promise<void> {
  const isGoal = isGoalEventType(input.eventType);
  const isRedCard = isRedCardEventType(input.eventType);
  const notified = new Set<string>();

  if (isGoal || isRedCard) {
    const type = isGoal ? "match_goal" : "match_red_card";
    const summary = isGoal
      ? `${input.playerName ? `${input.playerName} scores` : "Goal"} for ${input.teamName} (${input.minute}') vs ${input.opponentName}`
      : `${input.playerName ?? "A player"} is sent off for ${input.teamName} (${input.minute}') vs ${input.opponentName}`;

    const teamFollowers = await teamAudience(supabase, input.teamId);
    for (const id of teamFollowers) notified.add(id);
    await insertNotifications(supabase, teamFollowers, (profileId) => ({
      profile_id: profileId,
      type,
      payload: { fixture_id: input.fixtureId, summary, player_id: input.playerId },
    }));

    if (input.playerId) {
      const playerFollowers = await playerAudience(supabase, input.playerId);
      const newOnes = [...playerFollowers].filter((id) => !notified.has(id));
      for (const id of newOnes) notified.add(id);
      await insertNotifications(supabase, newOnes, (profileId) => ({
        profile_id: profileId,
        type,
        payload: { fixture_id: input.fixtureId, summary, player_id: input.playerId },
      }));
    }
    return;
  }

  if (!input.playerId) return;
  const playerFollowers = await playerAudience(supabase, input.playerId);
  const summary = `${input.playerName ?? "A player you follow"} — ${EVENT_LABEL[input.eventType]} (${input.minute}') in ${input.teamName} vs ${input.opponentName}`;
  await insertNotifications(supabase, playerFollowers, (profileId) => ({
    profile_id: profileId,
    type: "player_event",
    payload: { fixture_id: input.fixtureId, summary, player_id: input.playerId },
  }));
}
