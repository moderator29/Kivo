import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { batchFindMappedIds, findProviderEntityId } from "./provider-mappings";
import { shouldAttemptCapability } from "./coverage-registry";
import { SyncRunRecorder } from "./sync-run-recorder";
import { currentProviderSeason } from "./sync-coverage";
import type { SyncResult } from "./sync";
import type { NormalizedTopScorer } from "./types";
import { logError } from "@/lib/log";

/**
 * A competition's scoring chart (`top_scorers`, migration 0083).
 *
 * ## Rank comes from the provider, and is not recomputed
 *
 * Competitions break ties differently — goals, then assists, then minutes, in
 * most leagues, but not all of them, and not always in that order. The provider
 * applies the competition's own rules; re-sorting here would silently
 * substitute a different competition's rules for this one's, and a reader
 * looking at the chart would have no way to know. So `rank` is stored as sent.
 *
 * ## Rows for players KIVO has never synced are dropped, and counted
 *
 * A scoring chart names the twenty best players in a league, most of whom will
 * be at clubs KIVO has synced. The ones it has not are skipped rather than
 * inserted as bare names, because a chart row that cannot link to a player is a
 * name with a number next to it — and the run's failure list says how many were
 * lost, so a chart showing eleven of twenty is visibly incomplete to an admin
 * rather than quietly short.
 */
export async function syncCompetitionTopScorers(competitionId: string, season?: number): Promise<SyncResult> {
  const supabase = createServiceRoleSupabaseClient();
  const provider = await getFootballDataProvider();
  const seasonYear = season ?? currentProviderSeason();

  const recorder = await SyncRunRecorder.start(supabase, provider, "top_scorer");
  if (!recorder) return { status: "failed", recordsProcessed: 0, error: "Could not create sync_runs row" };

  const competitionProviderId = await findProviderEntityId(supabase, provider.name, "competition", competitionId);
  if (!competitionProviderId) {
    return recorder.finish("failed", 0, [
      `Competition ${competitionId} has no ${provider.name} mapping yet. Sync its fixtures first.`,
    ]);
  }

  // The chart is stored against a KIVO season row, so one has to exist. This is
  // a real precondition rather than a nullable convenience: a scoring chart with
  // no season is not attributable to anything, and `top_scorers.season_id` is
  // the column every read goes through.
  const { data: seasonRow, error: seasonError } = await supabase
    .from("seasons")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("provider_year", seasonYear)
    .maybeSingle();

  if (seasonError) {
    logError("football.sync-top-scorers.season", seasonError, { competitionId, season: seasonYear });
    return recorder.finish("failed", 0, [seasonError.message]);
  }
  if (!seasonRow) {
    return recorder.finish("failed", 0, [
      `No ${seasonYear} season is synced for this competition yet, so there is nothing to attach a scoring chart to.`,
    ]);
  }

  const { attempt } = await shouldAttemptCapability(
    supabase,
    provider.name,
    competitionId,
    "topScorers",
    seasonYear,
  );
  if (!attempt) {
    return recorder.finish("skipped", 0, [
      `${provider.name} declares no top-scorer coverage for this competition in ${seasonYear}. No request was made.`,
    ]);
  }

  let scorers: NormalizedTopScorer[];
  try {
    scorers = await provider.getTopScorers(competitionProviderId, seasonYear);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-top-scorers.fetch", err, { competitionId, season: seasonYear });
    return recorder.finish("failed", 0, [message]);
  }

  if (scorers.length === 0) return recorder.finish("success", 0, []);

  const [playerMappings, teamMappings] = await Promise.all([
    batchFindMappedIds(
      supabase,
      provider.name,
      "player",
      scorers.map((s) => s.playerProviderId),
    ),
    batchFindMappedIds(
      supabase,
      provider.name,
      "team",
      scorers.map((s) => s.teamProviderId).filter((id): id is string => id !== null),
    ),
  ]);

  const rows: Database["public"]["Tables"]["top_scorers"]["Insert"][] = [];
  const errors: string[] = [];

  for (const scorer of scorers) {
    const playerId = playerMappings.get(scorer.playerProviderId);
    if (!playerId) {
      errors.push(
        `rank ${scorer.rank}: player ${provider.name}:${scorer.playerProviderId} (${scorer.playerName}) is not in KIVO yet`,
      );
      continue;
    }
    rows.push({
      season_id: seasonRow.id,
      competition_id: competitionId,
      player_id: playerId,
      team_id: scorer.teamProviderId ? (teamMappings.get(scorer.teamProviderId) ?? null) : null,
      rank: scorer.rank,
      goals: scorer.goals,
      assists: scorer.assists,
      penalties_scored: scorer.penaltiesScored,
      appearances: scorer.appearances,
      minutes_played: scorer.minutesPlayed,
      captured_at: new Date().toISOString(),
    });
  }

  if (rows.length > 0) {
    // One statement rather than a row at a time: the chart is a single coherent
    // snapshot, and writing it in pieces would leave a reader able to see rank 1
    // and rank 3 without rank 2 mid-write.
    const { error } = await supabase.from("top_scorers").upsert(rows, { onConflict: "season_id,player_id" });
    if (error) {
      logError("football.sync-top-scorers.upsert", error, { competitionId });
      return recorder.finish("failed", 0, [...errors, error.message]);
    }
  }

  // Players who left the chart since the last sync would otherwise sit there
  // forever at a stale rank. Removing them is part of writing a *current*
  // standing rather than an append-only history — which is the distinction this
  // table's comment draws against `standings_snapshots`.
  const keptPlayerIds = rows.map((row) => row.player_id);
  if (keptPlayerIds.length > 0) {
    const { error: pruneError } = await supabase
      .from("top_scorers")
      .delete()
      .eq("season_id", seasonRow.id)
      .not("player_id", "in", `(${keptPlayerIds.join(",")})`);
    if (pruneError) {
      // A failed prune leaves a stale row visible, which is worth reporting but
      // is not worth discarding a chart that otherwise wrote correctly.
      logError("football.sync-top-scorers.prune", pruneError, { competitionId });
      errors.push(`could not remove players who have dropped off the chart: ${pruneError.message}`);
    }
  }

  return recorder.finish(
    SyncRunRecorder.verdict(rows.length, errors.length, scorers.length > 0),
    rows.length,
    errors,
  );
}
