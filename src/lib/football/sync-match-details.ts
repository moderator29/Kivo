import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { createMapping, findMappedId, findProviderEntityId } from "./provider-mappings";
import { syncTeamSquad } from "./sync-squads";
import type { SyncResult } from "./sync";
import type {
  NormalizedFixtureStatistics,
  NormalizedLineups,
  NormalizedMatchEvent,
  NormalizedMatchEventType,
  NormalizedTeam,
  NormalizedTeamLineup,
} from "./types";

type ServiceClient = SupabaseClient<Database>;

async function upsertTeam(supabase: ServiceClient, provider: string, team: NormalizedTeam): Promise<string> {
  const existing = await findMappedId(supabase, provider, "team", team.providerId);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("teams")
    .insert({ name: team.name, short_name: team.shortName, crest_url: team.crestUrl })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("Failed to insert team");

  await createMapping(supabase, provider, "team", team.providerId, data.id);
  return data.id;
}

function isKnownEventType(t: NormalizedMatchEventType): t is Exclude<NormalizedMatchEventType, "unknown"> {
  return t !== "unknown";
}

/** Fixture events aren't provider-mapped-by-nature (the provider gives events no id
 * of their own) but are still deduped through provider_mappings under entity_type
 * 'fixture_event', keyed on the synthetic composite id built in api-football.ts —
 * this makes syncFixtureDetails safe to call repeatedly for a live match without
 * writing duplicate event rows. */
async function upsertFixtureEvent(
  supabase: ServiceClient,
  providerName: string,
  fixtureId: string,
  teamId: string,
  playerId: string | null,
  relatedPlayerId: string | null,
  event: NormalizedMatchEvent & { eventType: Exclude<NormalizedMatchEventType, "unknown"> },
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

  const existingId = await findMappedId(supabase, providerName, "fixture_event", event.providerId);
  if (existingId) {
    const { error } = await supabase.from("fixture_events").update(payload).eq("id", existingId);
    if (error) throw error;
    return;
  }

  const { data, error } = await supabase.from("fixture_events").insert(payload).select("id").single();
  if (error || !data) throw error ?? new Error("Failed to insert fixture event");

  await createMapping(supabase, providerName, "fixture_event", event.providerId, data.id);
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
): Promise<number> {
  const teamId = await findMappedId(supabase, providerName, "team", side.team.providerId);
  if (!teamId) {
    unresolved.push(`team ${providerName}:${side.team.providerId} (${side.team.name}) has no KIVO mapping. Its whole lineup was skipped`);
    return 0;
  }

  await ensureTeamHasSquad(supabase, teamId, side.team.name, unresolved, autoSyncMissingSquads);

  let processed = 0;
  for (const entry of side.entries) {
    const playerId = await findMappedId(supabase, providerName, "player", entry.playerProviderId);
    if (!playerId) {
      unresolved.push(
        `player ${providerName}:${entry.playerProviderId} (${entry.playerName}) on team ${side.team.name} is not in KIVO yet. Lineup entry skipped`,
      );
      continue;
    }

    const { error } = await supabase.from("lineups").upsert(
      {
        fixture_id: fixtureId,
        team_id: teamId,
        player_id: playerId,
        is_starting: entry.isStarting,
        shirt_number: entry.shirtNumber,
        position: entry.position,
      },
      { onConflict: "fixture_id,team_id,player_id" },
    );
    if (error) throw error;
    processed += 1;
  }
  return processed;
}

async function processEvents(
  supabase: ServiceClient,
  providerName: string,
  fixtureId: string,
  events: NormalizedMatchEvent[],
  unresolved: string[],
): Promise<number> {
  let processed = 0;

  for (const event of events) {
    const eventType = event.eventType;
    if (!isKnownEventType(eventType)) {
      unresolved.push(
        `event ${providerName}:${event.providerId} has an unrecognized type/detail ("${event.detail ?? "no detail"}"). Skipped`,
      );
      continue;
    }

    const teamId = await findMappedId(supabase, providerName, "team", event.teamProviderId);
    if (!teamId) {
      unresolved.push(`team ${providerName}:${event.teamProviderId} has no KIVO mapping. Event skipped`);
      continue;
    }

    const playerId = event.playerProviderId
      ? await findMappedId(supabase, providerName, "player", event.playerProviderId)
      : null;
    if (event.playerProviderId && !playerId) {
      unresolved.push(
        `player ${providerName}:${event.playerProviderId} (${event.playerName ?? "unknown"}) not in KIVO. Event ${event.providerId} recorded without a player link`,
      );
    }
    const relatedPlayerId = event.relatedPlayerProviderId
      ? await findMappedId(supabase, providerName, "player", event.relatedPlayerProviderId)
      : null;

    try {
      await upsertFixtureEvent(supabase, providerName, fixtureId, teamId, playerId, relatedPlayerId, {
        ...event,
        eventType,
      });
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Fixture details sync: failed to upsert event ${providerName}:${event.providerId}`, err);
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
): Promise<number> {
  if (!statistics) return 0;

  let processed = 0;
  for (const side of statistics.teams) {
    const teamId = await findMappedId(supabase, providerName, "team", side.team.providerId);
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
      console.error(`Fixture details sync: failed to upsert statistics for team ${providerName}:${side.team.providerId}`, error);
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
    console.error("Failed to start fixture details sync run", startError);
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

  let lineups: NormalizedLineups | null = null;
  let events: NormalizedMatchEvent[] = [];
  let statistics: NormalizedFixtureStatistics | null = null;
  const unresolved: string[] = [];

  try {
    lineups = await provider.getLineups(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fixture details sync: getLineups failed (continuing without lineups)", err);
    unresolved.push(`lineups fetch: ${message}`);
  }

  try {
    events = await provider.getMatchEvents(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fixture details sync: getMatchEvents failed (continuing without events)", err);
    unresolved.push(`events fetch: ${message}`);
  }

  try {
    statistics = await provider.getFixtureStatistics(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fixture details sync: getFixtureStatistics failed (continuing without statistics)", err);
    unresolved.push(`statistics fetch: ${message}`);
  }

  let processed = 0;

  if (lineups) {
    for (const side of lineups.teams) {
      processed += await processLineupSide(supabase, provider.name, fixtureId, side, unresolved, autoSyncMissingSquads);
    }
  }

  processed += await processEvents(supabase, provider.name, fixtureId, events, unresolved);
  processed += await processStatistics(supabase, provider.name, fixtureId, statistics, unresolved);

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
    console.error("Failed to start standings sync run", startError);
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
    console.error("Standings sync: getStandings failed", err);
    return fail(message);
  }

  let processed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const teamId = await upsertTeam(supabase, provider.name, row.team);
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
      processed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Standings sync: failed to upsert standing for team ${provider.name}:${row.team.providerId}`, err);
      errors.push(`team ${provider.name}:${row.team.providerId} (${row.team.name}): ${message}`);
    }
  }

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
