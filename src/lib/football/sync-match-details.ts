import { logError } from "@/lib/log";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { batchFindMappedIds, createMapping, findProviderEntityId } from "./provider-mappings";
import { mapWithConcurrency } from "@/lib/concurrency";
import { syncTeamSquad } from "./sync-squads";
import type { SyncResult } from "./sync";
import { notifyFixtureEvent, notifyLineupsReleased } from "./match-notifications";
import { getKivoSystemProfileId, insertSystemEventPost } from "./match-room-system-posts";
import {
  recordAnomaly,
  recordEntityFailures,
  resolveEntityFailures,
  type EntityFailure,
} from "./sync-instrumentation";
import type {
  NormalizedFixtureStatistics,
  NormalizedLineups,
  NormalizedMatchEvent,
  NormalizedMatchEventType,
  NormalizedTeam,
  NormalizedTeamLineup,
} from "./types";

type ServiceClient = SupabaseClient<Database>;

/**
 * provider entity id -> KIVO id, resolved once up front for a whole sync run.
 *
 * KIVO_NEXT_GEN KN-12: every function below used to call `findMappedId` per
 * row. `processLineupSide` did it once per player (~22 a side, ~44 a fixture),
 * `processEvents` up to four times per event, and `syncStandings` once per
 * table row plus the upsert. RECOMMENDATIONS.md item 29 extracted those helpers
 * into one module and item 27 batched them — but only in sync.ts; this file was
 * never part of either pass, so a single "sync match details" click still cost
 * well over a hundred sequential single-row lookups before it wrote anything.
 *
 * Same contract as sync.ts's use of the same helper: the map is the existence
 * check, and a function that inserts a brand-new entity mutates it in place so
 * a later row in the same run reuses the id instead of inserting again.
 */
type MappingIndex = Map<string, string>;

/** Bounded concurrency for a lineup side's ~22 independent row upserts.
 * Matches syncTodayFixtures' pool size and reasoning (KIVO_NEXT_GEN KN-11):
 * Supabase's per-project connection pool is the constraint, and nothing in
 * that loop spends provider quota. */
const LINEUP_WRITE_CONCURRENCY = 6;

async function upsertTeam(
  supabase: ServiceClient,
  provider: string,
  team: NormalizedTeam,
  knownMappings: MappingIndex,
): Promise<string> {
  const existing = knownMappings.get(team.providerId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("teams")
    .insert({ name: team.name, short_name: team.shortName, crest_url: team.crestUrl })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to insert team");

  await createMapping(supabase, provider, "team", team.providerId, data.id);
  knownMappings.set(team.providerId, data.id);
  return data.id;
}

function isKnownEventType(t: NormalizedMatchEventType): t is Exclude<NormalizedMatchEventType, "unknown"> {
  return t !== "unknown";
}

/** Real name lookup for both sides of one fixture — fetched once per sync
 * (see syncFixtureDetails) and threaded through so upsertFixtureEvent can
 * label a notification ("Goal for Arsenal vs Chelsea") without a per-event
 * query. Absent/unmapped entirely if the fixture's own team names can't be
 * resolved — notifyFixtureEvent degrades to a generic label rather than
 * guessing a name (see its own summary-building code). */
export type FixtureTeamNames = Map<string, { name: string; opponentName: string }>;

/** Fixture events aren't provider-mapped-by-nature (the provider gives events no id
 * of their own) but are still deduped through provider_mappings under entity_type
 * 'fixture_event', keyed on the synthetic composite id built in api-football.ts —
 * this makes syncFixtureDetails safe to call repeatedly for a live match without
 * writing duplicate event rows. The update branch deliberately does NOT
 * re-notify — a notification fires once, off the real first-ever insert of this
 * event, never again on a later re-sync of the same match. */
async function upsertFixtureEvent(
  supabase: ServiceClient,
  providerName: string,
  fixtureId: string,
  teamId: string,
  playerId: string | null,
  relatedPlayerId: string | null,
  event: NormalizedMatchEvent & { eventType: Exclude<NormalizedMatchEventType, "unknown"> },
  teamNames: FixtureTeamNames,
  systemProfileId: string | null,
  eventMappings: MappingIndex,
): Promise<void> {
  const payload: Database["public"]["Tables"]["fixture_events"]["Insert"] = {
    fixture_id: fixtureId,
    team_id: teamId,
    player_id: playerId,
    related_player_id: relatedPlayerId,
    event_type: event.eventType,
    minute: event.minute,
    added_time: event.addedTime,
    detail: event.detail,
  };

  const existingId = eventMappings.get(event.providerId);
  if (existingId) {
    const { error } = await supabase.from("fixture_events").update(payload).eq("id", existingId);
    if (error) throw error;
    return;
  }

  const { data, error } = await supabase.from("fixture_events").insert(payload).select("id").single();

  /**
   * KIVO_NEXT_GEN KN-87. Dedup used to rest entirely on `provider_mappings`,
   * which holds exactly as long as the provider's event ids are stable — and
   * stops holding the moment a provider re-issues ids after a correction. Then
   * the same goal exists twice and every count downstream (goal timing, the
   * discipline table, fantasy scoring, the rating engine) is quietly wrong.
   *
   * Migration 0056 adds a unique index on what actually identifies the event in
   * the real world: fixture, team, type, minute, added time, and both players.
   * A 23505 here therefore means "this event is already recorded under a
   * different provider id" — which is a successful outcome, not a failure. It
   * maps the new provider id onto the row that already exists, so the next
   * sync takes the cheap update branch above, and records the collision as a
   * real anomaly rather than a log line, because a provider re-keying its
   * events is exactly the kind of thing Data Health should be able to show.
   *
   * The notification and Match Room post below are deliberately skipped on
   * this path: the event was already announced when it was first inserted, and
   * announcing it again because the provider changed an id would be a
   * notification about nothing.
   */
  if (error?.code === "23505") {
    const { data: existingByNaturalKey } = await supabase
      .from("fixture_events")
      .select("id")
      .eq("fixture_id", fixtureId)
      .eq("team_id", teamId)
      .eq("event_type", event.eventType)
      .eq("minute", event.minute)
      .limit(1)
      .maybeSingle();

    await recordAnomaly(supabase, {
      anomalyType: "duplicate_event",
      provider: providerName,
      entityType: "fixture_event",
      detail: `Provider re-reported an already-recorded ${event.eventType} at minute ${event.minute} under a new id (${event.providerId}).`,
      providerEntityId: event.providerId,
      kivoEntityId: existingByNaturalKey?.id ?? null,
    });

    if (existingByNaturalKey) {
      await createMapping(supabase, providerName, "fixture_event", event.providerId, existingByNaturalKey.id);
      eventMappings.set(event.providerId, existingByNaturalKey.id);
    }
    return;
  }

  if (error || !data) throw error ?? new Error("Failed to insert fixture event");

  await createMapping(supabase, providerName, "fixture_event", event.providerId, data.id);
  eventMappings.set(event.providerId, data.id);

  // RECOMMENDATIONS.md notification items: goal / red card / a followed
  // player's involvement — real event, first-ever insert only (see the doc
  // comment above). A team whose name couldn't be resolved this run just
  // gets a generic label rather than blocking the notification outright.
  const names = teamNames.get(teamId);
  await notifyFixtureEvent(supabase, {
    fixtureId,
    teamId,
    teamName: names?.name ?? "Their team",
    opponentName: names?.opponentName ?? "the opposition",
    eventType: event.eventType,
    minute: event.minute,
    playerId,
    playerName: event.playerName,
  });

  // RECOMMENDATIONS.md item 254: same real-insert-only moment, same team
  // name resolution, now also announced inside the fixture's own Match Room
  // — see match-room-system-posts.ts for the goal/red-card gating and the
  // is_system safety guarantees.
  await insertSystemEventPost(supabase, systemProfileId, {
    fixtureId,
    teamName: names?.name ?? "Their team",
    eventType: event.eventType,
    minute: event.minute,
    addedTime: event.addedTime,
    playerName: event.playerName,
  });
}

async function teamHasSquad(supabase: ServiceClient, teamId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("current_team_id", teamId);
  if (error) throw error;
  return Boolean(count);
}

/**
 * If a team has zero players synced yet, its lineup entries can never resolve to a
 * player_id. RECOMMENDATIONS.md item 59: this used to unconditionally pull that
 * team's full squad (2+ more provider calls) the moment it was found empty — an
 * admin syncing details for several fixtures across unseen teams could blow a
 * meaningful chunk of the 100/day quota on one click without ever being told.
 * `autoSyncMissingSquads` (default false, see syncFixtureDetails) makes that spend
 * opt-in: off, a team with no squad yet just has its lineup entries skipped and
 * logged so the admin can see why and sync that team's squad deliberately; on,
 * behavior is unchanged from before this item — pull the squad inline. Failures
 * here are logged, not thrown either way: lineup entries that still can't resolve
 * afterward are skipped gracefully by the caller.
 */
async function ensureTeamHasSquad(
  supabase: ServiceClient,
  teamId: string,
  teamName: string,
  unresolved: string[],
  autoSyncMissingSquads: boolean,
): Promise<void> {
  if (await teamHasSquad(supabase, teamId)) return;

  if (!autoSyncMissingSquads) {
    unresolved.push(
      `team ${teamName} has no squad synced yet, so its lineup entries were skipped (not auto-synced, to protect the daily quota). Sync its squad, or re-run with squad auto-sync enabled, to resolve them.`,
    );
    return;
  }

  const result = await syncTeamSquad(teamId);
  if (result.status === "failed") {
    unresolved.push(`auto squad sync for team ${teamId} failed: ${result.error ?? "unknown error"}`);
  }
}

async function processLineupSide(
  supabase: ServiceClient,
  providerName: string,
  fixtureId: string,
  side: NormalizedTeamLineup,
  unresolved: string[],
  autoSyncMissingSquads: boolean,
  teamMappings: MappingIndex,
  playerMappings: MappingIndex,
): Promise<number> {
  const teamId = teamMappings.get(side.team.providerId);
  if (!teamId) {
    unresolved.push(`team ${providerName}:${side.team.providerId} (${side.team.name}) has no KIVO mapping. Its whole lineup was skipped`);
    return 0;
  }

  await ensureTeamHasSquad(supabase, teamId, side.team.name, unresolved, autoSyncMissingSquads);

  // The squad auto-sync above can have inserted players this run, so the
  // mapping index is refreshed for anything still missing rather than assumed
  // stale — one extra round trip at most, and only when a lineup actually
  // references a player that was not mapped before this function ran.
  const stillUnmapped = side.entries
    .map((entry) => entry.playerProviderId)
    .filter((providerId) => !playerMappings.has(providerId));
  if (stillUnmapped.length > 0) {
    const late = await batchFindMappedIds(supabase, providerName, "player", stillUnmapped);
    for (const [providerId, kivoId] of late) playerMappings.set(providerId, kivoId);
  }

  // Bounded concurrency rather than a serial await per player: a full side is
  // ~22 independent upserts against one table, and they have no ordering
  // relationship with each other. Same pool size and same reasoning as
  // syncTodayFixtures' loop — Supabase's connection pool, not the provider, is
  // the constraint here (nothing in this loop touches the provider at all).
  const results = await mapWithConcurrency(side.entries, LINEUP_WRITE_CONCURRENCY, async (entry) => {
    const playerId = playerMappings.get(entry.playerProviderId);
    if (!playerId) {
      return `player ${providerName}:${entry.playerProviderId} (${entry.playerName}) on team ${side.team.name} is not in KIVO yet. Lineup entry skipped`;
    }

    const { error } = await supabase.from("lineups").upsert(
      {
        fixture_id: fixtureId,
        team_id: teamId,
        player_id: playerId,
        is_starting: entry.isStarting,
        shirt_number: entry.shirtNumber,
        position: entry.position,
        formation: side.formation,
        // The provider's own formation slot ("row:col", migration 0081). Real
        // positional data that this request already paid for — the same
        // reasoning that maps `photo` through on squads rather than leaving a
        // field KIVO was sent on the floor. Null for every substitute, which is
        // the provider's answer and not a gap.
        grid: entry.grid,
      },
      { onConflict: "fixture_id,team_id,player_id" },
    );
    if (error) throw error;
    return null;
  });

  // Collected and appended in input order, so a concurrent pool cannot make the
  // admin-facing `unresolved` list come out in a different order each run.
  let processed = 0;
  for (const message of results) {
    if (message === null) processed += 1;
    else unresolved.push(message);
  }
  return processed;
}

async function processEvents(
  supabase: ServiceClient,
  providerName: string,
  fixtureId: string,
  events: NormalizedMatchEvent[],
  unresolved: string[],
  teamNames: FixtureTeamNames,
  systemProfileId: string | null,
  teamMappings: MappingIndex,
  playerMappings: MappingIndex,
  eventMappings: MappingIndex,
): Promise<number> {
  let processed = 0;

  // Deliberately still sequential, unlike the lineup loop above: each iteration
  // can fire a notification fan-out and write a Match Room post, and the order
  // those land in a live Room is the order the events happened. The cost this
  // item is about was never the loop's shape — it was the four single-row
  // lookups per event, which are now map reads.
  for (const event of events) {
    const eventType = event.eventType;
    if (!isKnownEventType(eventType)) {
      unresolved.push(
        `event ${providerName}:${event.providerId} has an unrecognized type/detail ("${event.detail ?? "no detail"}"). Skipped`,
      );
      continue;
    }

    const teamId = teamMappings.get(event.teamProviderId);
    if (!teamId) {
      unresolved.push(`team ${providerName}:${event.teamProviderId} has no KIVO mapping. Event skipped`);
      continue;
    }

    const playerId = event.playerProviderId ? (playerMappings.get(event.playerProviderId) ?? null) : null;
    if (event.playerProviderId && !playerId) {
      unresolved.push(
        `player ${providerName}:${event.playerProviderId} (${event.playerName ?? "unknown"}) not in KIVO. Event ${event.providerId} recorded without a player link`,
      );
    }
    const relatedPlayerId = event.relatedPlayerProviderId
      ? (playerMappings.get(event.relatedPlayerProviderId) ?? null)
      : null;

    try {
      await upsertFixtureEvent(
        supabase,
        providerName,
        fixtureId,
        teamId,
        playerId,
        relatedPlayerId,
        { ...event, eventType },
        teamNames,
        systemProfileId,
        eventMappings,
      );
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-match-details.fixtureDetailsSyncUpsert", err, { detail: `Fixture details sync: failed to upsert event ${providerName}:${event.providerId}` });
      unresolved.push(`event ${providerName}:${event.providerId}: ${message}`);
    }
  }

  return processed;
}

/** fixture_statistics rows aren't independently provider-mapped (same rationale as
 * lineups/standings — the provider gives no per-row id, just one entry per side of
 * one fixture) — deduped instead on the table's own (fixture_id, team_id) unique
 * constraint. A side whose team has no KIVO mapping yet is skipped and logged rather
 * than guessed at. */
async function processStatistics(
  supabase: ServiceClient,
  providerName: string,
  fixtureId: string,
  statistics: NormalizedFixtureStatistics | null,
  unresolved: string[],
  teamMappings: MappingIndex,
): Promise<number> {
  if (!statistics) return 0;

  let processed = 0;
  for (const side of statistics.teams) {
    const teamId = teamMappings.get(side.team.providerId);
    if (!teamId) {
      unresolved.push(
        `team ${providerName}:${side.team.providerId} (${side.team.name}) has no KIVO mapping. Its statistics were skipped`,
      );
      continue;
    }

    const { error } = await supabase.from("fixture_statistics").upsert(
      {
        fixture_id: fixtureId,
        team_id: teamId,
        shots_total: side.shotsTotal,
        shots_on_target: side.shotsOnTarget,
        shots_off_target: side.shotsOffTarget,
        shots_blocked: side.shotsBlocked,
        shots_inside_box: side.shotsInsideBox,
        shots_outside_box: side.shotsOutsideBox,
        fouls: side.fouls,
        corners: side.corners,
        offsides: side.offsides,
        possession_pct: side.possessionPct,
        yellow_cards: side.yellowCards,
        red_cards: side.redCards,
        saves: side.saves,
        passes_total: side.passesTotal,
        passes_accurate: side.passesAccurate,
        passes_pct: side.passesPct,
        expected_goals: side.expectedGoals,
      },
      { onConflict: "fixture_id,team_id" },
    );
    if (error) {
      logError("football.sync-match-details.fixtureDetailsSyncUpsert", error, { detail: `Fixture details sync: failed to upsert statistics for team ${providerName}:${side.team.providerId}` });
      unresolved.push(`statistics for team ${providerName}:${side.team.providerId} (${side.team.name}): ${error.message}`);
      continue;
    }
    processed += 1;
  }
  return processed;
}

/**
 * On-demand sync of one fixture's lineups + match events + team statistics. Given a
 * KIVO fixture id, resolves its provider id, fetches all three, and upserts. Players
 * referenced by a lineup that belongs to a team with no squad synced yet are skipped
 * and logged unless `autoSyncMissingSquads` is set (see ensureTeamHasSquad,
 * RECOMMENDATIONS.md item 59) — default false, so a "sync match details" click never
 * silently spends the 2+ extra provider calls a squad sync costs per unseen team.
 * Any player still unresolved after that is skipped and logged rather than crashing
 * the whole sync. Safe to call repeatedly for a live match — see upsertFixtureEvent's
 * dedupe note (statistics are upserted on the fixture_statistics table's own unique
 * constraint, same idea).
 */
export async function syncFixtureDetails(
  fixtureId: string,
  options: { autoSyncMissingSquads?: boolean } = {},
): Promise<SyncResult> {
  const autoSyncMissingSquads = options.autoSyncMissingSquads ?? false;
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "lineup", status: "running" })
    .select("id")
    .single();

  if (startError || !syncRun) {
    logError("football.sync-match-details.startFixtureDetailsSync", startError);
    return {
      status: "failed",
      recordsProcessed: 0,
      error: startError?.message ?? "Could not create sync_runs row",
    };
  }

  const fail = async (message: string): Promise<SyncResult> => {
    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        records_processed: 0,
        error_message: message,
        // RECOMMENDATIONS.md item 53: real quota data even on a hard failure.
        provider_quota_remaining: provider.getQuotaRemaining(),
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
  };

  const fixtureProviderId = await findProviderEntityId(supabase, provider.name, "fixture", fixtureId);
  if (!fixtureProviderId) {
    return fail(`Fixture ${fixtureId} has no ${provider.name} provider mapping yet. Sync today's fixtures first.`);
  }

  // RECOMMENDATIONS.md notification items: real team names for this fixture's
  // two sides, fetched once so upsertFixtureEvent can label a goal/red-card
  // notification without a per-event query. Absent (empty map) degrades to a
  // generic label in notifyFixtureEvent rather than blocking the notification.
  // Fetched alongside item 254's system-post author id (also resolved once
  // per run, same "thread it through instead of a per-event query" shape —
  // see getKivoSystemProfileId's own doc comment).
  const [{ data: fixtureTeamsRow }, systemProfileId] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        `home_team_id, away_team_id,
         home_team:teams!fixtures_home_team_id_fkey(name),
         away_team:teams!fixtures_away_team_id_fkey(name)`,
      )
      .eq("id", fixtureId)
      .maybeSingle(),
    getKivoSystemProfileId(supabase),
  ]);
  const teamNames: FixtureTeamNames = new Map();
  if (fixtureTeamsRow?.home_team?.name && fixtureTeamsRow.away_team?.name) {
    teamNames.set(fixtureTeamsRow.home_team_id, {
      name: fixtureTeamsRow.home_team.name,
      opponentName: fixtureTeamsRow.away_team.name,
    });
    teamNames.set(fixtureTeamsRow.away_team_id, {
      name: fixtureTeamsRow.away_team.name,
      opponentName: fixtureTeamsRow.home_team.name,
    });
  }

  let lineups: NormalizedLineups | null = null;
  let events: NormalizedMatchEvent[] = [];
  let statistics: NormalizedFixtureStatistics | null = null;
  const unresolved: string[] = [];

  try {
    lineups = await provider.getLineups(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-match-details.fixtureDetailsSyncGetlineups", err);
    unresolved.push(`lineups fetch: ${message}`);
  }

  try {
    events = await provider.getMatchEvents(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-match-details.fixtureDetailsSyncGetmatchevents", err);
    unresolved.push(`events fetch: ${message}`);
  }

  try {
    statistics = await provider.getFixtureStatistics(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-match-details.fixtureDetailsSyncGetfixturestatistics", err);
    unresolved.push(`statistics fetch: ${message}`);
  }

  // KIVO_NEXT_GEN KN-12: resolve every provider id this whole run references in
  // three round trips, up front, instead of one single-row lookup per player,
  // per event, per event's players, and per statistics side. Everything has
  // been fetched by this point, so every id the run will ever ask about is
  // already known — there is nothing to discover incrementally, which is what
  // made the per-row lookups avoidable rather than merely unfortunate.
  const teamProviderIds = [
    ...(lineups?.teams ?? []).map((t) => t.team.providerId),
    ...events.map((e) => e.teamProviderId),
    ...(statistics?.teams ?? []).map((t) => t.team.providerId),
  ];
  const playerProviderIds = [
    ...(lineups?.teams ?? []).flatMap((t) => t.entries.map((entry) => entry.playerProviderId)),
    ...events.flatMap((e) => [e.playerProviderId, e.relatedPlayerProviderId]),
  ].filter((id): id is string => id !== null);

  const [teamMappings, playerMappings, eventMappings] = await Promise.all([
    batchFindMappedIds(supabase, provider.name, "team", teamProviderIds),
    batchFindMappedIds(supabase, provider.name, "player", playerProviderIds),
    batchFindMappedIds(
      supabase,
      provider.name,
      "fixture_event",
      events.map((e) => e.providerId),
    ),
  ]);

  let processed = 0;

  if (lineups) {
    // Asked BEFORE anything is written, because "were team sheets already in
    // KIVO" is only answerable before this run puts them there. A details sync
    // re-run over a fixture whose lineup KIVO already held must notify nobody
    // — the same discipline upsertFixtureEvent's dedupe branch applies to
    // goals.
    const { count: lineupRowsBefore } = await supabase
      .from("lineups")
      .select("id", { count: "exact", head: true })
      .eq("fixture_id", fixtureId);

    let lineupRowsWritten = 0;
    for (const side of lineups.teams) {
      lineupRowsWritten += await processLineupSide(
        supabase,
        provider.name,
        fixtureId,
        side,
        unresolved,
        autoSyncMissingSquads,
        teamMappings,
        playerMappings,
      );
    }
    processed += lineupRowsWritten;

    // Team news is in, and this is the first time KIVO has held it. Needs the
    // real club names — without them the notification could only say "a match
    // you follow", which is not worth a bell — so a fixture whose teams could
    // not be resolved above produces nothing rather than something vague.
    if (
      (lineupRowsBefore ?? 0) === 0 &&
      lineupRowsWritten > 0 &&
      fixtureTeamsRow?.home_team?.name &&
      fixtureTeamsRow.away_team?.name
    ) {
      await notifyLineupsReleased(supabase, {
        fixtureId,
        homeTeamId: fixtureTeamsRow.home_team_id,
        awayTeamId: fixtureTeamsRow.away_team_id,
        homeTeamName: fixtureTeamsRow.home_team.name,
        awayTeamName: fixtureTeamsRow.away_team.name,
      });
    }
  }

  processed += await processEvents(
    supabase,
    provider.name,
    fixtureId,
    events,
    unresolved,
    teamNames,
    systemProfileId,
    teamMappings,
    playerMappings,
    eventMappings,
  );
  processed += await processStatistics(supabase, provider.name, fixtureId, statistics, unresolved, teamMappings);

  const finishedAt = new Date().toISOString();
  const hadWork =
    (lineups?.teams.some((t) => t.entries.length > 0) ?? false) ||
    events.length > 0 ||
    (statistics?.teams.length ?? 0) > 0;
  const dbStatus: Database["public"]["Enums"]["sync_status"] =
    unresolved.length === 0 ? "success" : hadWork && processed === 0 ? "failed" : "partial";
  const errorMessage = unresolved.length > 0 ? unresolved.slice(0, 20).join("; ") : null;

  await supabase
    .from("sync_runs")
    .update({
      status: dbStatus,
      finished_at: finishedAt,
      last_synced_at: finishedAt,
      records_processed: processed,
      // KIVO_NEXT_GEN KN-88: previously a run that did 8 of 10 and a run that
      // did 8 of 8 were indistinguishable in this table — `records_processed`
      // counted successes and nothing counted the rest. `unresolved` is
      // already the real list of things that did not work; this is its length.
      records_failed: unresolved.length,
      error_message: errorMessage,
      // RECOMMENDATIONS.md item 53: the provider's own remaining-quota count,
      // not an estimate — see ApiFootballProvider.getQuotaRemaining().
      provider_quota_remaining: provider.getQuotaRemaining(),
    })
    .eq("id", syncRun.id);

  return {
    status: dbStatus === "failed" ? "failed" : "succeeded",
    recordsProcessed: processed,
    error: errorMessage ?? undefined,
  };
}

/**
 * On-demand sync of a season's full standings table. Given a KIVO season id,
 * resolves its competition's provider id + the season's year, fetches the
 * standings table, and upserts one row per team (deduped on the table's own
 * (season_id, team_id) unique constraint — standings rows aren't independently
 * provider-mapped, same rationale as lineups above).
 */
export async function syncStandings(seasonId: string): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    .insert({ provider: provider.name, entity_type: "standing", status: "running" })
    .select("id")
    .single();

  if (startError || !syncRun) {
    logError("football.sync-match-details.startStandingsSyncRun", startError);
    return {
      status: "failed",
      recordsProcessed: 0,
      error: startError?.message ?? "Could not create sync_runs row",
    };
  }

  const fail = async (message: string): Promise<SyncResult> => {
    await supabase
      .from("sync_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        records_processed: 0,
        error_message: message,
        // RECOMMENDATIONS.md item 53: real quota data even on a hard failure.
        provider_quota_remaining: provider.getQuotaRemaining(),
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
  };

  // provider_year (migration 0028, RECOMMENDATIONS.md item 30) is the bare
  // year upsertSeason in sync.ts recorded alongside the "YYYY/YYYY+1" display
  // string it writes to `name` — read that directly instead of parsing it
  // back out of the display string.
  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, competition_id, provider_year")
    .eq("id", seasonId)
    .maybeSingle();
  if (seasonError) return fail(seasonError.message);
  if (!season) return fail(`Season ${seasonId} not found.`);

  const year = season.provider_year;

  const leagueProviderId = await findProviderEntityId(supabase, provider.name, "competition", season.competition_id);
  if (!leagueProviderId) {
    return fail(
      `Competition ${season.competition_id} has no ${provider.name} provider mapping yet. Sync its fixtures first.`,
    );
  }

  let rows;
  try {
    rows = await provider.getStandings(leagueProviderId, year);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-match-details.standingsSyncGetstandings", err);
    return fail(message);
  }

  // KIVO_NEXT_GEN KN-12: one lookup for the whole table instead of one per
  // row inside upsertTeam. A standings table is 18-24 teams that KIVO has
  // almost always already mapped from the fixtures sync, so this replaces
  // ~20 sequential single-row selects with one.
  const teamMappings = await batchFindMappedIds(
    supabase,
    provider.name,
    "team",
    rows.map((row) => row.team.providerId),
  );

  let processed = 0;
  const errors: string[] = [];
  // KN-81: the retryable half of the same information `errors` renders as
  // prose — one row per team that failed, so a standings run that lost three
  // clubs can be retried for those three instead of re-fetching the table.
  const entityFailures: EntityFailure[] = [];
  const succeededProviderIds: string[] = [];

  for (const row of rows) {
    try {
      const teamId = await upsertTeam(supabase, provider.name, row.team, teamMappings);
      const { error } = await supabase.from("standings").upsert(
        {
          season_id: seasonId,
          team_id: teamId,
          played: row.played,
          won: row.won,
          drawn: row.drawn,
          lost: row.lost,
          goals_for: row.goalsFor,
          goals_against: row.goalsAgainst,
          points: row.points,
          position: row.rank,
        },
        { onConflict: "season_id,team_id" },
      );
      if (error) throw error;

      // KIVO_NEXT_GEN KN-85: the table row above was just overwritten in place,
      // which is what destroyed every previous version of it. This appends what
      // it now says to an immutable history, and writes nothing when nothing
      // changed — so a table refreshed hourly between matchdays does not grow.
      const { error: snapshotError } = await supabase.rpc("record_standings_snapshot", {
        p_season_id: seasonId,
        p_team_id: teamId,
        p_position: row.rank,
        p_played: row.played,
        p_won: row.won,
        p_drawn: row.drawn,
        p_lost: row.lost,
        p_goals_for: row.goalsFor,
        p_goals_against: row.goalsAgainst,
        p_points: row.points,
      });
      // Deliberately not thrown: history is valuable, and it is not worth
      // failing a standings sync that already wrote the real table for.
      if (snapshotError) {
        logError("football.standings.recordSnapshot", snapshotError, { seasonId, teamId });
      }

      processed += 1;
      succeededProviderIds.push(row.team.providerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("football.sync-match-details.standingsSyncUpsertStanding", err, { detail: `Standings sync: failed to upsert standing for team ${provider.name}:${row.team.providerId}` });
      errors.push(`team ${provider.name}:${row.team.providerId} (${row.team.name}): ${message}`);
      entityFailures.push({
        providerEntityId: row.team.providerId,
        message,
        code: typeof err === "object" && err !== null && "code" in err ? String(err.code) : null,
        label: row.team.name,
      });
    }
  }

  await Promise.all([
    resolveEntityFailures(supabase, {
      provider: provider.name,
      entityType: "team",
      providerEntityIds: succeededProviderIds,
    }),
    recordEntityFailures(supabase, {
      syncRunId: syncRun.id,
      provider: provider.name,
      entityType: "team",
      failures: entityFailures,
    }),
  ]);

  const finishedAt = new Date().toISOString();
  const hadRows = rows.length > 0;
  const dbStatus: Database["public"]["Enums"]["sync_status"] =
    errors.length === 0 ? "success" : hadRows && processed === 0 ? "failed" : "partial";
  const errorMessage = errors.length > 0 ? errors.slice(0, 20).join("; ") : null;

  await supabase
    .from("sync_runs")
    .update({
      status: dbStatus,
      finished_at: finishedAt,
      last_synced_at: finishedAt,
      records_processed: processed,
      records_failed: entityFailures.length, // KN-88, same reasoning as syncFixtureDetails above
      error_message: errorMessage,
      // RECOMMENDATIONS.md item 53: the provider's own remaining-quota count,
      // not an estimate — see ApiFootballProvider.getQuotaRemaining().
      provider_quota_remaining: provider.getQuotaRemaining(),
    })
    .eq("id", syncRun.id);

  return {
    status: dbStatus === "failed" ? "failed" : "succeeded",
    recordsProcessed: processed,
    error: errorMessage ?? undefined,
  };
}
