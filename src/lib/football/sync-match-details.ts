import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { syncTeamSquad } from "./sync-squads";
import type { SyncResult } from "./sync";
import type { NormalizedLineups, NormalizedMatchEvent, NormalizedMatchEventType, NormalizedTeam, NormalizedTeamLineup } from "./types";

type ServiceClient = SupabaseClient<Database>;
type EntityType = Database["public"]["Enums"]["provider_entity_type"];

// Deliberately duplicated from sync.ts — see the doc comment at the top of
// sync-squads.ts for why these small helpers live here again instead of being
// imported from (or added to) the already-reviewed sync.ts.
async function findMappedId(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .eq("provider_entity_id", providerEntityId)
    .maybeSingle();

  if (error) throw error;
  return data?.kivo_entity_id ?? null;
}

/** Reverse of findMappedId — given a KIVO id, find the provider's own id for it.
 * Needed here (unlike sync.ts) because callers pass in a KIVO fixture/season id
 * and this file has to go the other direction to call the provider API. */
async function findProviderEntityId(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  kivoEntityId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("provider_mappings")
    .select("provider_entity_id")
    .eq("provider", provider)
    .eq("entity_type", entityType)
    .eq("kivo_entity_id", kivoEntityId)
    .maybeSingle();

  if (error) throw error;
  return data?.provider_entity_id ?? null;
}

async function createMapping(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  providerEntityId: string,
  kivoEntityId: string,
): Promise<void> {
  const { error } = await supabase
    .from("provider_mappings")
    .insert({ provider, entity_type: entityType, provider_entity_id: providerEntityId, kivo_entity_id: kivoEntityId });
  // 23505 = another concurrent sync already created this mapping — fine, it points
  // at the same kivo entity either way.
  if (error && error.code !== "23505") throw error;
}

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

/** If a team has zero players synced yet, pull its squad first so lineup entries
 * can actually resolve to a player_id — otherwise every entry would be skipped on
 * a team's very first fixture-details sync. Failures here are logged, not thrown:
 * lineup entries that still can't resolve afterward are skipped gracefully below. */
async function ensureTeamHasSquad(supabase: ServiceClient, teamId: string, unresolved: string[]): Promise<void> {
  const { count, error } = await supabase
    .from("players")
    .select("id", { count: "exact", head: true })
    .eq("current_team_id", teamId);
  if (error) throw error;
  if (count) return;

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
): Promise<number> {
  const teamId = await findMappedId(supabase, providerName, "team", side.team.providerId);
  if (!teamId) {
    unresolved.push(`team ${providerName}:${side.team.providerId} (${side.team.name}) has no KIVO mapping — its whole lineup was skipped`);
    return 0;
  }

  await ensureTeamHasSquad(supabase, teamId, unresolved);

  let processed = 0;
  for (const entry of side.entries) {
    const playerId = await findMappedId(supabase, providerName, "player", entry.playerProviderId);
    if (!playerId) {
      unresolved.push(
        `player ${providerName}:${entry.playerProviderId} (${entry.playerName}) on team ${side.team.name} is not in KIVO yet — lineup entry skipped`,
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
        `event ${providerName}:${event.providerId} has an unrecognized type/detail ("${event.detail ?? "no detail"}") — skipped`,
      );
      continue;
    }

    const teamId = await findMappedId(supabase, providerName, "team", event.teamProviderId);
    if (!teamId) {
      unresolved.push(`team ${providerName}:${event.teamProviderId} has no KIVO mapping — event skipped`);
      continue;
    }

    const playerId = event.playerProviderId
      ? await findMappedId(supabase, providerName, "player", event.playerProviderId)
      : null;
    if (event.playerProviderId && !playerId) {
      unresolved.push(
        `player ${providerName}:${event.playerProviderId} (${event.playerName ?? "unknown"}) not in KIVO — event ${event.providerId} recorded without a player link`,
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
      unresolved.push(`event ${providerName}:${event.providerId} — ${message}`);
    }
  }

  return processed;
}

/**
 * On-demand sync of one fixture's lineups + match events. Given a KIVO fixture id,
 * resolves its provider id, fetches both, and upserts. Players referenced by a
 * lineup/event that aren't in KIVO yet trigger an on-demand squad sync for that
 * team (see ensureTeamHasSquad); any player still unresolved after that is skipped
 * and logged rather than crashing the whole sync. Safe to call repeatedly for a
 * live match — see upsertFixtureEvent's dedupe note.
 */
export async function syncFixtureDetails(fixtureId: string): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    // No dedicated 'lineup' provider_entity_type exists (lineups aren't independently
    // provider-mapped — see NormalizedLineups doc comments) — 'fixture_event' is the
    // closest of the existing enum values to "this fixture's in-match detail data".
    .insert({ provider: provider.name, entity_type: "fixture_event", status: "running" })
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
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
  };

  const fixtureProviderId = await findProviderEntityId(supabase, provider.name, "fixture", fixtureId);
  if (!fixtureProviderId) {
    return fail(`Fixture ${fixtureId} has no ${provider.name} provider mapping yet — sync today's fixtures first.`);
  }

  let lineups: NormalizedLineups | null = null;
  let events: NormalizedMatchEvent[] = [];
  const unresolved: string[] = [];

  try {
    lineups = await provider.getLineups(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fixture details sync: getLineups failed (continuing without lineups)", err);
    unresolved.push(`lineups fetch — ${message}`);
  }

  try {
    events = await provider.getMatchEvents(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Fixture details sync: getMatchEvents failed (continuing without events)", err);
    unresolved.push(`events fetch — ${message}`);
  }

  let processed = 0;

  if (lineups) {
    for (const side of lineups.teams) {
      processed += await processLineupSide(supabase, provider.name, fixtureId, side, unresolved);
    }
  }

  processed += await processEvents(supabase, provider.name, fixtureId, events, unresolved);

  const finishedAt = new Date().toISOString();
  const hadWork = (lineups?.teams.some((t) => t.entries.length > 0) ?? false) || events.length > 0;
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
  const provider = getFootballDataProvider();

  const { data: syncRun, error: startError } = await supabase
    .from("sync_runs")
    // No dedicated 'standing' provider_entity_type exists either — 'season' is the
    // closest existing enum value to "this season's standings table".
    .insert({ provider: provider.name, entity_type: "season", status: "running" })
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
      })
      .eq("id", syncRun.id);
    return { status: "failed", recordsProcessed: 0, error: message };
  };

  const { data: season, error: seasonError } = await supabase
    .from("seasons")
    .select("id, competition_id, name")
    .eq("id", seasonId)
    .maybeSingle();
  if (seasonError) return fail(seasonError.message);
  if (!season) return fail(`Season ${seasonId} not found.`);

  const year = Number(season.name);
  if (!Number.isFinite(year)) {
    return fail(`Season ${seasonId} has a non-numeric name ("${season.name}") that can't be mapped to a provider year.`);
  }

  const leagueProviderId = await findProviderEntityId(supabase, provider.name, "competition", season.competition_id);
  if (!leagueProviderId) {
    return fail(
      `Competition ${season.competition_id} has no ${provider.name} provider mapping yet — sync its fixtures first.`,
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
      errors.push(`team ${provider.name}:${row.team.providerId} (${row.team.name}) — ${message}`);
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
    })
    .eq("id", syncRun.id);

  return {
    status: dbStatus === "failed" ? "failed" : "succeeded",
    recordsProcessed: processed,
    error: errorMessage ?? undefined,
  };
}
