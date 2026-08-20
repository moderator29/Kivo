import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { batchFindMappedIds, findProviderEntityId } from "./provider-mappings";
import { SyncRunRecorder, recordUnstartableRun } from "./sync-run-recorder";
import { resolveSeasonYear } from "./target-season";
import type { SyncResult } from "./sync";
import type { NormalizedPlayerSeasonStatistics } from "./types";
import { logError } from "@/lib/log";

/**
 * One player's season aggregates (`player_season_statistics`, migration 0083).
 *
 * The largest single data unlock on this API: one row per player per
 * competition per season is what makes a career breakdown, competition splits,
 * a radar chart and a fantasy price grounded in real output possible at all.
 *
 * ## Never summed
 *
 * The provider returns one entry per competition; every one is stored. Summing
 * them would be lossy and irreversible — "14 goals" cannot be turned back into
 * "11 in the league, 3 in the cup" — and the split is the whole reason this is
 * worth having. Anything that wants a total adds these up.
 *
 * ## A competition KIVO has never synced is still recorded
 *
 * A player's season legitimately includes competitions and clubs KIVO does not
 * hold. Dropping those rows would under-report a career while looking complete,
 * which is a quieter and worse failure than showing a row whose competition is
 * named but not linked. So the provider's ids are always written and the KIVO
 * foreign keys are nullable, exactly as `transfers` does for clubs — and
 * `reconcilePlayerSeasonCompetitions` fills them in later for free.
 *
 * ## No coverage guard here, deliberately
 *
 * The registry's `players` flag is per COMPETITION, and this call is per PLAYER
 * across every competition they played in. There is no single competition to
 * ask about before the response arrives, so gating on one would mean either
 * picking a competition arbitrarily or refusing the call. It is one request per
 * player, made on demand, which is already the narrowest scope available.
 */
export async function syncPlayerSeasonStatistics(playerId: string, season?: number): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  // Wrapped so a press that never reaches a provider still leaves a row. A sync
  // that throws here inserts nothing and updates nothing, which in `sync_runs`
  // is indistinguishable from a button nobody touched — see
  // `recordUnstartableRun`.
  let provider;
  try {
    provider = await getFootballDataProvider();
  } catch (err) {
    return recordUnstartableRun(
      supabase,
      "player_season_statistic",
      `The season statistics sync could not start: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  // The operator's target season, not the calendar's. Season-scoped
  // endpoints are refused outright by a free API-Football plan asked for the
  // current year — see target-season.ts for the provider's own wording.
  const seasonYear = await resolveSeasonYear(supabase, provider.name, season);

  const recorder = await SyncRunRecorder.start(supabase, provider, "player_season_statistic");
  if (!recorder) return { status: "failed", recordsProcessed: 0, error: "Could not create sync_runs row" };

  const playerProviderId = await findProviderEntityId(supabase, provider.name, "player", playerId);
  if (!playerProviderId) {
    return recorder.finish("failed", 0, [
      `Player ${playerId} has no ${provider.name} mapping yet. Sync their team's squad first.`,
    ]);
  }

  let rows: NormalizedPlayerSeasonStatistics[];
  try {
    rows = await provider.getPlayerSeasonStatistics(playerProviderId, seasonYear);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-player-season-statistics.fetch", err, { playerId, season: seasonYear });
    return recorder.finish("failed", 0, [message]);
  }

  if (rows.length === 0) {
    return recorder.finish("success", 0, []);
  }

  const [competitionMappings, teamMappings] = await Promise.all([
    batchFindMappedIds(
      supabase,
      provider.name,
      "competition",
      rows.map((row) => row.competitionProviderId),
    ),
    batchFindMappedIds(
      supabase,
      provider.name,
      "team",
      rows.map((row) => row.teamProviderId).filter((id): id is string => id !== null),
    ),
  ]);

  // A season row exists per (competition, provider_year). Resolved in one query
  // for every competition this player appeared in, rather than one per row.
  const competitionIds = Array.from(competitionMappings.values());
  const seasonIdByCompetition = new Map<string, string>();
  if (competitionIds.length > 0) {
    const { data: seasonRows, error: seasonError } = await supabase
      .from("seasons")
      .select("id, competition_id")
      .in("competition_id", competitionIds)
      .eq("provider_year", seasonYear);
    if (seasonError) {
      // Not fatal: season_id is nullable and only sharpens a later join. The
      // statistics themselves are keyed by season_year, which is always present.
      logError("football.sync-player-season-statistics.seasons", seasonError, { playerId });
    }
    for (const row of seasonRows ?? []) seasonIdByCompetition.set(row.competition_id, row.id);
  }

  const payload: Database["public"]["Tables"]["player_season_statistics"]["Insert"][] = rows.map((row) => {
    const competitionId = competitionMappings.get(row.competitionProviderId) ?? null;
    return {
      provider: provider.name,
      player_id: playerId,
      provider_competition_id: row.competitionProviderId,
      competition_id: competitionId,
      competition_name: row.competitionName,
      season_year: row.season,
      season_id: competitionId ? (seasonIdByCompetition.get(competitionId) ?? null) : null,
      provider_team_id: row.teamProviderId,
      team_id: row.teamProviderId ? (teamMappings.get(row.teamProviderId) ?? null) : null,
      team_name: row.teamName,
      position: row.position,
      appearances: row.appearances,
      lineups: row.lineups,
      minutes_played: row.minutesPlayed,
      provider_rating: row.providerRating,
      goals: row.goals,
      assists: row.assists,
      goals_conceded: row.goalsConceded,
      saves: row.saves,
      shots_total: row.shotsTotal,
      shots_on_target: row.shotsOnTarget,
      passes_total: row.passesTotal,
      passes_key: row.passesKey,
      pass_accuracy: row.passAccuracy,
      tackles_total: row.tacklesTotal,
      blocks: row.blocks,
      interceptions: row.interceptions,
      duels_total: row.duelsTotal,
      duels_won: row.duelsWon,
      dribbles_attempted: row.dribblesAttempted,
      dribbles_succeeded: row.dribblesSucceeded,
      fouls_drawn: row.foulsDrawn,
      fouls_committed: row.foulsCommitted,
      yellow_cards: row.yellowCards,
      red_cards: row.redCards,
      penalties_scored: row.penaltiesScored,
      penalties_missed: row.penaltiesMissed,
      retrieved_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from("player_season_statistics")
    .upsert(payload, { onConflict: "provider,player_id,provider_competition_id,season_year" });

  if (error) {
    logError("football.sync-player-season-statistics.upsert", error, { playerId });
    return recorder.finish("failed", 0, [error.message]);
  }

  const unlinked = payload.filter((row) => row.competition_id === null).length;
  const notes =
    unlinked > 0
      ? [
          `${unlinked} of ${payload.length} rows are for competitions KIVO has not synced. They are stored in full with the provider's own ids and will link themselves once those competitions exist.`,
        ]
      : [];

  // `partial` rather than `success` when something is unlinked: the rows are all
  // written, but a career breakdown built from them today cannot name every
  // competition, and that is worth being visible in Data Health rather than
  // discovered on a player page.
  return recorder.finish(notes.length > 0 ? "partial" : "success", payload.length, notes);
}

/**
 * Links season-statistics rows to competitions KIVO has synced since they were
 * written. Zero provider calls, bounded per run — same shape and rationale as
 * `reconcileUnresolvedTransferTeams` and `reconcileCoverageCompetitions`.
 */
const RECONCILE_BATCH_LIMIT = 500;

export async function reconcilePlayerSeasonCompetitions(): Promise<{ error: string | null; recordsProcessed: number }> {
  const supabase = createServiceRoleSupabaseClient();

  let providerName: string;
  try {
    providerName = (await getFootballDataProvider()).name;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), recordsProcessed: 0 };
  }

  const { data: rows, error } = await supabase
    .from("player_season_statistics")
    .select("id, provider_competition_id, provider_team_id, season_year, team_id")
    .eq("provider", providerName)
    .is("competition_id", null)
    .limit(RECONCILE_BATCH_LIMIT);

  if (error) {
    logError("football.sync-player-season-statistics.reconcileLoad", error);
    return { error: "Couldn't load unresolved season statistics. Try again.", recordsProcessed: 0 };
  }
  if (!rows || rows.length === 0) return { error: null, recordsProcessed: 0 };

  const competitionMappings = await batchFindMappedIds(
    supabase,
    providerName,
    "competition",
    rows.map((row) => row.provider_competition_id),
  );
  const teamMappings = await batchFindMappedIds(
    supabase,
    providerName,
    "team",
    rows.map((row) => row.provider_team_id).filter((id): id is string => id !== null),
  );

  let resolved = 0;
  for (const row of rows) {
    const competitionId = competitionMappings.get(row.provider_competition_id);
    if (!competitionId) continue;

    const { data: seasonRow } = await supabase
      .from("seasons")
      .select("id")
      .eq("competition_id", competitionId)
      .eq("provider_year", row.season_year)
      .maybeSingle();

    const update: Database["public"]["Tables"]["player_season_statistics"]["Update"] = {
      competition_id: competitionId,
      season_id: seasonRow?.id ?? null,
    };
    // Only fills a team that is still missing — never overwrites one an earlier
    // sync legitimately resolved.
    if (row.team_id === null && row.provider_team_id) {
      const teamId = teamMappings.get(row.provider_team_id);
      if (teamId) update.team_id = teamId;
    }

    const { error: updateError } = await supabase.from("player_season_statistics").update(update).eq("id", row.id);
    if (updateError) {
      logError("football.sync-player-season-statistics.reconcileUpdate", updateError, { detail: `row ${row.id}` });
      continue;
    }
    resolved += 1;
  }

  return { error: null, recordsProcessed: resolved };
}
