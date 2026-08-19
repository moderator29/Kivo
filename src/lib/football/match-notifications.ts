import { logError } from "@/lib/log";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { EVENT_LABEL, isGoalEventType, isPenaltyEventType, isRedCardEventType } from "./event-labels";
import { resolveNotifiableRecipients, type NotificationPreferenceColumn } from "@/lib/notification-preferences";
import { breaksThroughQuietHours } from "@/lib/notification-registry";
import { buildNotification } from "@/lib/notification-payloads";

// RECOMMENDATIONS.md item 285: every notification type this file produces
// (match_kickoff, match_result, match_goal, match_red_card, player_event) is
// still just "something happened in a match" from the settings page's own
// point of view — match_alerts_enabled is the one column Settings exposes
// for all of it ("Kickoff, goals and full-time for teams you follow", see
// notification-preferences-panel.tsx), so every insertNotifications call
// below gates on this same column rather than inventing a finer-grained one
// nothing in Settings could actually control yet.
const MATCH_NOTIFICATION_COLUMN = "match_alerts_enabled";

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
    // RECOMMENDATIONS.md item 287: muted=false excludes a follow the user has
    // explicitly silenced for this one team via the mute toggle next to the
    // follow star (teams/[id]/page.tsx) — profiles.favourite_team_id has no
    // equivalent mute column, so that half of the audience is unaffected (a
    // favourite team has no per-entity mute today).
    supabase
      .from("follows")
      .select("follower_profile_id")
      .eq("followed_type", "team")
      .eq("followed_id", teamId)
      .eq("muted", false),
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
    .eq("followed_id", playerId)
    .eq("muted", false);
  return new Set((followers ?? []).map((row) => row.follower_profile_id));
}

/**
 * RECOMMENDATIONS.md item 285: the shared write path every producer below
 * funnels through, so the preference gate only has to be wired in once.
 *
 * KIVO_NEXT_GEN KN-9: the gate used to be `shouldNotify` mapped over the
 * audience — one single-row select per recipient, all fired concurrently from
 * inside a running sync before a single notification row was written. This
 * file's own comment defended that as "simplicity over scale", which was
 * honest while the product had no followers and stops being true the first
 * time one club does; a goal for a 50,000-follower club is 50,000 queries
 * ahead of one insert, at the exact moment the platform is busiest.
 * `filterNotifiable` is the same rule (absent row = defaults = notify) in one
 * chunked query per 300 recipients.
 */
async function insertNotifications(
  supabase: ServiceClient,
  profileIds: Iterable<string>,
  column: NotificationPreferenceColumn,
  build: (profileId: string) => NotificationInsert,
): Promise<void> {
  const ids = Array.from(new Set(profileIds));
  if (ids.length === 0) return;

  // Migration 0088. One resolution per audience, not per recipient: the same
  // chunked query that answers "may this person be notified" also answers
  // "are they in their quiet hours right now", because both are read at the
  // same moment by the same producer over the same people.
  const recipients = await resolveNotifiableRecipients(supabase, ids, column);
  if (recipients.length === 0) return;

  const rows = recipients.map((recipient) => {
    const row = build(recipient.profileId);
    // The row is written either way — quiet hours defer the interruption, not
    // the information. `quiet_until` only holds it back from the unread badge,
    // and a high-priority type ignores the window entirely.
    return breaksThroughQuietHours(row.type) ? row : { ...row, quiet_until: recipient.quietUntil };
  });

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) logError("football.match-notifications.matchNotificationsInsertNotification", error);
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

  let type: "match_kickoff" | "match_halftime" | "match_result" | null = null;
  let summary: string | null = null;

  // The score, when KIVO really has both halves of it. Never "0-0" as a
  // stand-in for "not synced" — an absent score simply drops out of the line.
  const score = input.homeScore !== null && input.awayScore !== null ? ` ${input.homeScore}-${input.awayScore}` : "";

  if (input.newStatus === "live" && input.previousStatus !== "live") {
    type = "match_kickoff";
    summary = `${input.homeTeamName} vs ${input.awayTeamName} has kicked off`;
  } else if (input.newStatus === "halftime" && input.previousStatus !== "halftime") {
    // `fixture_status` has carried 'halftime' since migration 0001 and this
    // branch never existed, so a real, KIVO-observed transition was being
    // watched and then thrown away. The same "only on an observed transition"
    // rule as its siblings applies: a fixture first seen at half time produces
    // nothing, because "it just happened" would be a guess.
    type = "match_halftime";
    summary = score
      ? `Half time: ${input.homeTeamName}${score} ${input.awayTeamName}`
      : `Half time: ${input.homeTeamName} vs ${input.awayTeamName}`;
  } else if (input.newStatus === "finished" && input.previousStatus !== "finished") {
    type = "match_result";
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

  // KN-90: every payload below is built through the typed constructor, so a
  // match notification cannot ship without the two fields its renderer has no
  // way to reconstruct (the fixture it links to, and the summary line built
  // here from team names the renderer never sees).
  await insertNotifications(supabase, audience, MATCH_NOTIFICATION_COLUMN, (profileId) =>
    buildNotification(profileId, finalType, { fixture_id: input.fixtureId, summary: finalSummary }),
  );
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
  // A penalty is checked before "is this a goal", because `penalty_goal`
  // is both. The founding brief names penalties as their own notification,
  // and it is right to: a spot kick is a different moment from an open-play
  // goal, and a *missed* one — which changes nothing on the scoreboard and so
  // reached only the taker's own followers — is often the bigger story of the
  // two. One event still produces one notification; this is a more specific
  // type, not an extra bell.
  const isPenalty = isPenaltyEventType(input.eventType);
  const isGoal = !isPenalty && isGoalEventType(input.eventType);
  const isRedCard = isRedCardEventType(input.eventType);
  const notified = new Set<string>();

  if (isPenalty || isGoal || isRedCard) {
    const type = isPenalty ? "match_penalty" : isGoal ? "match_goal" : "match_red_card";
    const summary = isPenalty
      ? penaltySummary(input)
      : isGoal
        ? `${input.playerName ? `${input.playerName} scores` : "Goal"} for ${input.teamName} (${input.minute}') vs ${input.opponentName}`
        : `${input.playerName ?? "A player"} is sent off for ${input.teamName} (${input.minute}') vs ${input.opponentName}`;

    const teamFollowers = await teamAudience(supabase, input.teamId);
    for (const id of teamFollowers) notified.add(id);
    await insertNotifications(supabase, teamFollowers, MATCH_NOTIFICATION_COLUMN, (profileId) =>
      buildNotification(profileId, type, { fixture_id: input.fixtureId, summary, player_id: input.playerId }),
    );

    if (input.playerId) {
      const playerFollowers = await playerAudience(supabase, input.playerId);
      const newOnes = [...playerFollowers].filter((id) => !notified.has(id));
      for (const id of newOnes) notified.add(id);
      await insertNotifications(supabase, newOnes, MATCH_NOTIFICATION_COLUMN, (profileId) =>
        buildNotification(profileId, type, { fixture_id: input.fixtureId, summary, player_id: input.playerId }),
      );
    }
    return;
  }

  if (!input.playerId) return;
  const playerFollowers = await playerAudience(supabase, input.playerId);
  const summary = `${input.playerName ?? "A player you follow"} — ${EVENT_LABEL[input.eventType]} (${input.minute}') in ${input.teamName} vs ${input.opponentName}`;
  await insertNotifications(supabase, playerFollowers, MATCH_NOTIFICATION_COLUMN, (profileId) =>
    buildNotification(profileId, "player_event", {
      fixture_id: input.fixtureId,
      summary,
      player_id: input.playerId,
    }),
  );
}


/**
 * A penalty, in one line, saying which of the two things happened.
 *
 * Scored and missed are not the same event and must not read as one — "penalty
 * for X" would be actively misleading about a save. The taker's name is
 * included when the provider sent one and left out when it did not, rather
 * than filled in with a placeholder.
 */
function penaltySummary(input: FixtureEventNotificationInput): string {
  const scored = input.eventType === "penalty_goal";
  const who = input.playerName;
  const when = `(${input.minute}') vs ${input.opponentName}`;
  if (scored) {
    return who
      ? `${who} scores a penalty for ${input.teamName} ${when}`
      : `Penalty scored for ${input.teamName} ${when}`;
  }
  return who
    ? `${who} misses a penalty for ${input.teamName} ${when}`
    : `Penalty missed for ${input.teamName} ${when}`;
}

export interface LineupsReleasedInput {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
}

/**
 * Team news is in.
 *
 * The most time-sensitive pre-match moment in football — it is when fantasy
 * squads get changed and predictions get made — and KIVO produced nothing for
 * it, despite writing the `lineups` rows itself.
 *
 * Called only when a fixture goes from having NO lineup rows to having some,
 * which is what makes this "released" rather than "re-synced". A details sync
 * re-run over a fixture whose lineup KIVO already held notifies nobody, the
 * same discipline `upsertFixtureEvent`'s dedupe branch already applies to
 * goals: repeating a sync must never repeat a notification.
 */
export async function notifyLineupsReleased(
  supabase: ServiceClient,
  input: LineupsReleasedInput,
): Promise<void> {
  const [homeAudience, awayAudience] = await Promise.all([
    teamAudience(supabase, input.homeTeamId),
    teamAudience(supabase, input.awayTeamId),
  ]);
  const audience = new Set<string>([...homeAudience, ...awayAudience]);
  const summary = `Team news: lineups are in for ${input.homeTeamName} vs ${input.awayTeamName}`;

  await insertNotifications(supabase, audience, MATCH_NOTIFICATION_COLUMN, (profileId) =>
    buildNotification(profileId, "match_lineups", { fixture_id: input.fixtureId, summary }),
  );
}
