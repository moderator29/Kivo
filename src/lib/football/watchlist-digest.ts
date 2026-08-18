import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { EVENT_LABEL } from "./event-labels";
import { fetchFixturesForTeams } from "./fixtures-by-team";

/**
 * KIVO_NEXT_GEN KN-106: what actually happened to the players and teams you're
 * watching.
 *
 * `/saved` is a bookmark list: rows you added, in the order you added them. It
 * has no reason to be revisited, because nothing on it ever changes. The digest
 * is what turns it into something worth coming back to — and it is buildable
 * entirely from data KIVO already has, with nothing invented anywhere:
 *
 *   * Real `fixture_events` rows naming a watched player.
 *   * Real finished `fixtures` involving a watched team, with real scores.
 *   * Real `transfers` rows involving a watched player or team.
 *
 * There is no ranking, no "trending", no relevance score and no "you might have
 * missed" — every entry is a thing that demonstrably happened, ordered by when
 * it happened. This codebase has no view-tracking or engagement log, so any
 * notion of "missed" would be fabricated, and the item that proposed this said
 * in-app only for the same reason: `notification_deliveries` still has no
 * producer, so a "digest" that claimed to have been sent anywhere would be
 * claiming something that never happened.
 *
 * Watched means saved **or** followed. Both tables express the same intent and
 * a user who did one of them does not expect the other list to be the one that
 * counts.
 */

type Client = SupabaseClient<Database>;

/** Match events and results within this window. A week is the natural unit for
 * "what did I miss" in football — it is one round of fixtures. */
const EVENT_WINDOW_DAYS = 7;

/** Transfers move slowly and matter for longer, so they get their own, wider
 * window rather than being squeezed into the match one. */
const TRANSFER_WINDOW_DAYS = 30;

/** Ceilings, per section. A digest is a summary; an unbounded list is the feed
 * this is meant to save someone from reading. */
const MAX_ITEMS_PER_SECTION = 12;

/** Bound on watched entities carried into the queries below, so a user with a
 * very long watchlist cannot turn this into an unbounded `in.(…)` filter — the
 * same failure mode KN-15 describes on `/home`. */
const MAX_WATCHED_ENTITIES = 60;

export interface DigestEvent {
  id: string;
  kind: "player_event" | "team_result" | "transfer";
  /** ISO instant the thing happened, for ordering and display. */
  at: string;
  /** Real, already-resolved sentence. No template is filled with a guess. */
  text: string;
  /** Where this leads — a fixture, a player or a team page. */
  href: string;
}

export interface WatchlistDigest {
  events: DigestEvent[];
  watchedPlayerCount: number;
  watchedTeamCount: number;
  eventWindowDays: number;
  transferWindowDays: number;
  /** True when a watchlist was truncated before querying, so the UI can say so
   * rather than silently reporting on part of it. */
  watchlistTruncated: boolean;
}

/**
 * `saves` and `follows` are both polymorphic with no DB-level FK on the target
 * id (see migration 0001's comment on `follows`), so this resolves ids first
 * and hydrates names second — the same two-step every other polymorphic reader
 * in this codebase uses.
 */
export async function buildWatchlistDigest(supabase: Client, profileId: string): Promise<WatchlistDigest> {
  const [{ data: saves }, { data: follows }] = await Promise.all([
    supabase.from("saves").select("target_type, target_id").eq("profile_id", profileId),
    supabase
      .from("follows")
      .select("followed_type, followed_id")
      .eq("follower_profile_id", profileId)
      .in("followed_type", ["team", "player"]),
  ]);

  const playerIdSet = new Set<string>();
  const teamIdSet = new Set<string>();
  for (const row of saves ?? []) {
    if (row.target_type === "player") playerIdSet.add(row.target_id);
    if (row.target_type === "team") teamIdSet.add(row.target_id);
  }
  for (const row of follows ?? []) {
    if (row.followed_type === "player") playerIdSet.add(row.followed_id);
    if (row.followed_type === "team") teamIdSet.add(row.followed_id);
  }

  const allPlayerIds = [...playerIdSet];
  const allTeamIds = [...teamIdSet];
  const playerIds = allPlayerIds.slice(0, MAX_WATCHED_ENTITIES);
  const teamIds = allTeamIds.slice(0, MAX_WATCHED_ENTITIES);
  const watchlistTruncated = allPlayerIds.length > playerIds.length || allTeamIds.length > teamIds.length;

  const empty: WatchlistDigest = {
    events: [],
    watchedPlayerCount: allPlayerIds.length,
    watchedTeamCount: allTeamIds.length,
    eventWindowDays: EVENT_WINDOW_DAYS,
    transferWindowDays: TRANSFER_WINDOW_DAYS,
    watchlistTruncated,
  };
  if (playerIds.length === 0 && teamIds.length === 0) return empty;

  const now = Date.now();
  const eventSince = new Date(now - EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const transferSince = new Date(now - TRANSFER_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const fixtureSelect = `id, kickoff_at, home_score, away_score, home_team_id, away_team_id,
     home_team:teams!fixtures_home_team_id_fkey(name),
     away_team:teams!fixtures_away_team_id_fkey(name)`;

  const [{ data: playerEvents }, teamFixtures, { data: transfers }] = await Promise.all([
    playerIds.length
      ? supabase
          .from("fixture_events")
          .select(
            `id, event_type, minute, added_time, player_id,
             player:players!fixture_events_player_id_fkey(known_as, full_name),
             fixture:fixtures!inner(id, kickoff_at,
               home_team:teams!fixtures_home_team_id_fkey(name),
               away_team:teams!fixtures_away_team_id_fkey(name))`,
          )
          .in("player_id", playerIds)
          .gte("fixture.kickoff_at", eventSince)
          .order("created_at", { ascending: false })
          .limit(MAX_ITEMS_PER_SECTION)
      : Promise.resolve({ data: [] }),
    // Through fetchFixturesForTeams rather than a hand-built `.or()` string: a
    // watchlist is unbounded by nature and that is exactly the filter shape
    // KN-15 removed from /home. Descending (most recent first), which the
    // helper's sorted-prefix merge handles symmetrically — see its module doc.
    fetchFixturesForTeams(
      teamIds,
      MAX_ITEMS_PER_SECTION,
      (column, ids) =>
        supabase
          .from("fixtures")
          .select(fixtureSelect)
          .eq("status", "finished")
          .gte("kickoff_at", eventSince)
          .in(column, ids)
          .order("kickoff_at", { ascending: false })
          .limit(MAX_ITEMS_PER_SECTION),
      "desc",
    ),
    playerIds.length || teamIds.length
      ? supabase
          .from("transfers")
          .select(
            `id, transfer_date, transfer_type, fee_text, player_id, from_team_id, to_team_id,
             player:players(known_as, full_name),
             from_team:teams!transfers_from_team_id_fkey(name),
             to_team:teams!transfers_to_team_id_fkey(name)`,
          )
          .gte("transfer_date", transferSince)
          .order("transfer_date", { ascending: false })
          .limit(MAX_ITEMS_PER_SECTION * 4)
      : Promise.resolve({ data: [] }),
  ]);

  const events: DigestEvent[] = [];

  for (const row of playerEvents ?? []) {
    if (!row.fixture) continue;
    const name = row.player?.known_as || row.player?.full_name || "A player you watch";
    const opponents = `${row.fixture.home_team?.name ?? "Unknown"} v ${row.fixture.away_team?.name ?? "Unknown"}`;
    const minute = `${row.minute}${row.added_time ? `+${row.added_time}` : ""}'`;
    events.push({
      id: `event:${row.id}`,
      kind: "player_event",
      at: row.fixture.kickoff_at,
      text: `${name} — ${EVENT_LABEL[row.event_type]} (${minute}) in ${opponents}`,
      href: `/matches/${row.fixture.id}`,
    });
  }

  const watchedTeams = new Set(teamIds);
  for (const row of teamFixtures) {
    const home = row.home_team?.name ?? "Unknown";
    const away = row.away_team?.name ?? "Unknown";
    // Scores are nullable even on a finished fixture (a provider that reported
    // the status but not the result). Say "played" rather than inventing 0-0.
    const score = row.home_score !== null && row.away_score !== null ? `${row.home_score}-${row.away_score}` : null;
    const watched = watchedTeams.has(row.home_team_id) ? home : watchedTeams.has(row.away_team_id) ? away : null;
    events.push({
      id: `fixture:${row.id}`,
      kind: "team_result",
      at: row.kickoff_at,
      text: score
        ? `${home} ${score} ${away}${watched ? ` — ${watched} played` : ""}`
        : `${home} v ${away} finished, but no score has been synced yet`,
      href: `/matches/${row.id}`,
    });
  }

  // Filtered in memory rather than with a third `.or()` across three columns:
  // the query above is already bounded by date and row count, and the
  // alternative is a filter string built from two unbounded id lists at once —
  // exactly the shape KN-15 exists to remove from this codebase. Matched on
  // ids, never on names, so two clubs with similar names can never be conflated.
  for (const row of transfers ?? []) {
    const involvesWatched =
      (row.player_id !== null && playerIdSet.has(row.player_id)) ||
      (row.from_team_id !== null && teamIdSet.has(row.from_team_id)) ||
      (row.to_team_id !== null && teamIdSet.has(row.to_team_id));
    if (!involvesWatched) continue;
    const name = row.player?.known_as || row.player?.full_name || "A player you watch";
    const from = row.from_team?.name ?? "an unlisted club";
    const to = row.to_team?.name ?? "an unlisted club";
    const fee = row.fee_text ? ` (${row.fee_text})` : "";
    events.push({
      id: `transfer:${row.id}`,
      kind: "transfer",
      at: `${row.transfer_date}T00:00:00Z`,
      text: `${name}: ${from} → ${to}${fee}`,
      href: row.player_id ? `/players/${row.player_id}` : "/transfers",
    });
  }

  events.sort((a, b) => b.at.localeCompare(a.at));

  return {
    ...empty,
    events: events.slice(0, MAX_ITEMS_PER_SECTION * 2),
  };
}
