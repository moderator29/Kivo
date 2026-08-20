import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";
import { getFootballDataProvider } from "./index";
import { batchFindMappedIds, findProviderEntityId } from "./provider-mappings";
import { shouldAttemptCapability } from "./coverage-registry";
import { SyncRunRecorder, recordUnstartableRun } from "./sync-run-recorder";
import type { SyncResult } from "./sync";
import type { NormalizedFixturePlayerStatistics } from "./types";
import { logError } from "@/lib/log";

/**
 * Per-player match statistics (`fixture_player_statistics`, migration 0081).
 *
 * ## Why this is a separate, deliberate call
 *
 * It is one provider request per fixture, on top of the three `syncFixtureDetails`
 * already makes for lineups, events and team statistics. On a hundred requests a
 * day, adding a fourth to every fixture sync would cut the number of matches
 * KIVO can cover by a quarter — so this is opt-in, per fixture, rather than
 * folded into the default path.
 *
 * ## What it unlocks
 *
 * Minutes played, shots, passes, key passes, tackles, interceptions, blocks,
 * duels, dribbles and fouls, per player. That is the richer event basis the
 * heatmap's derived shape uses, and it is the difference between a shape built
 * from goals-and-cards and one built from a player's whole involvement. It is
 * also, independently, the real source for a player-ratings surface.
 *
 * ## What it is not
 *
 * There are no coordinates in this payload. Not on the free tier, not on any
 * tier. This endpoint says what a player did, never where — which is why
 * everything the heatmap builds on it is tagged `derived` and captioned as an
 * inference rather than a measurement.
 */
export async function syncFixturePlayerStatistics(fixtureId: string): Promise<SyncResult> {
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
      "fixture_player_statistic",
      `The player match statistics sync could not start: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const recorder = await SyncRunRecorder.start(supabase, provider, "fixture_player_statistic");
  if (!recorder) return { status: "failed", recordsProcessed: 0, error: "Could not create sync_runs row" };

  const { data: fixture, error: fixtureError } = await supabase
    .from("fixtures")
    .select("id, competition_id, season:seasons(provider_year)")
    .eq("id", fixtureId)
    .maybeSingle();

  if (fixtureError || !fixture) {
    logError("football.sync-fixture-player-statistics.loadFixture", fixtureError, { fixtureId });
    return recorder.finish("failed", 0, [fixtureError?.message ?? `Fixture ${fixtureId} not found.`]);
  }

  const fixtureProviderId = await findProviderEntityId(supabase, provider.name, "fixture", fixtureId);
  if (!fixtureProviderId) {
    return recorder.finish("failed", 0, [`Fixture ${fixtureId} has no ${provider.name} mapping yet.`]);
  }

  // The registry's own flag for this exact endpoint. A competition the provider
  // says publishes no per-player statistics never gets asked twice.
  const { attempt } = await shouldAttemptCapability(
    supabase,
    provider.name,
    fixture.competition_id,
    "fixturePlayerStatistics",
    fixture.season?.provider_year ?? undefined,
  );
  if (!attempt) {
    return recorder.finish("skipped", 0, [
      `${provider.name} declares no per-player match statistics for this competition. No request was made.`,
    ]);
  }

  let payload: NormalizedFixturePlayerStatistics | null;
  try {
    payload = await provider.getFixturePlayerStatistics(fixtureProviderId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError("football.sync-fixture-player-statistics.fetch", err, { fixtureId });
    return recorder.finish("failed", 0, [message]);
  }

  if (!payload || payload.players.length === 0) {
    // Null covers both "not published yet" (before kickoff) and "this plan never
    // publishes it". Neither is a failure, and this method genuinely cannot tell
    // them apart — the registry is what can, and it was already consulted above.
    return recorder.finish("success", 0, []);
  }

  const [playerMappings, teamMappings] = await Promise.all([
    batchFindMappedIds(
      supabase,
      provider.name,
      "player",
      payload.players.map((p) => p.playerProviderId),
    ),
    batchFindMappedIds(
      supabase,
      provider.name,
      "team",
      payload.players.map((p) => p.teamProviderId),
    ),
  ]);

  const rows: Database["public"]["Tables"]["fixture_player_statistics"]["Insert"][] = [];
  const errors: string[] = [];

  for (const stat of payload.players) {
    const playerId = playerMappings.get(stat.playerProviderId);
    const teamId = teamMappings.get(stat.teamProviderId);
    if (!playerId || !teamId) {
      errors.push(
        `player ${provider.name}:${stat.playerProviderId} (${stat.playerName}) is not in KIVO yet — their match statistics were skipped`,
      );
      continue;
    }
    rows.push({
      fixture_id: fixtureId,
      player_id: playerId,
      team_id: teamId,
      minutes_played: stat.minutesPlayed,
      position: stat.position,
      is_substitute: stat.isSubstitute,
      provider_rating: stat.providerRating,
      shots_total: stat.shotsTotal,
      shots_on_target: stat.shotsOnTarget,
      goals: stat.goals,
      assists: stat.assists,
      goals_conceded: stat.goalsConceded,
      saves: stat.saves,
      passes_total: stat.passesTotal,
      passes_key: stat.passesKey,
      pass_accuracy: stat.passAccuracy,
      tackles_total: stat.tacklesTotal,
      blocks: stat.blocks,
      interceptions: stat.interceptions,
      duels_total: stat.duelsTotal,
      duels_won: stat.duelsWon,
      dribbles_attempted: stat.dribblesAttempted,
      dribbles_succeeded: stat.dribblesSucceeded,
      dribbled_past: stat.dribbledPast,
      fouls_drawn: stat.foulsDrawn,
      fouls_committed: stat.foulsCommitted,
      yellow_cards: stat.yellowCards,
      red_cards: stat.redCards,
      offsides: stat.offsides,
      penalties_won: stat.penaltiesWon,
      penalties_committed: stat.penaltiesCommitted,
      penalties_scored: stat.penaltiesScored,
      penalties_missed: stat.penaltiesMissed,
      penalties_saved: stat.penaltiesSaved,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("fixture_player_statistics")
      .upsert(rows, { onConflict: "fixture_id,player_id" });
    if (error) {
      logError("football.sync-fixture-player-statistics.upsert", error, { fixtureId });
      return recorder.finish("failed", 0, [...errors, error.message]);
    }

    // Every cached heatmap for this fixture was built before these numbers
    // existed, so its inputs fingerprint no longer matches and it would be
    // ignored on read anyway. Deleting it rather than leaving it to be skipped
    // keeps the cache a set of currently-valid rows instead of an accumulation
    // of superseded ones — and this is the one moment KIVO knows for certain
    // that every grid for this fixture is out of date.
    const { error: invalidateError } = await supabase.from("player_heatmaps").delete().eq("fixture_id", fixtureId);
    if (invalidateError) {
      logError("football.sync-fixture-player-statistics.invalidateHeatmaps", invalidateError, { fixtureId });
    }
  }

  return recorder.finish(
    SyncRunRecorder.verdict(rows.length, errors.length, payload.players.length > 0),
    rows.length,
    errors,
  );
}
