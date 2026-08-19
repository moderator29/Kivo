import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { buildFixtureHeatmaps, buildPlayerHeatmap } from "./fixture-heatmap";
import type { FixtureHeatmapSet, HeatmapLineupInput, PlayerHeatmapSubject } from "./fixture-heatmap";
import type { MatchEventInput, PlayerMatchStatisticsInput } from "./event-normalizer";
import type { AggregatedHeatmap } from "./heatmap-aggregator";
import { HeatmapCache, fingerprintHeatmapInputs, type CachePeriod } from "./heatmap-cache";

type ServiceClient = SupabaseClient<Database>;

/**
 * `HeatmapService` — the first of the five services, and the only one that
 * touches the database.
 *
 * It exists so that exactly one place knows how to answer "what is this
 * fixture's heatmap?": load the real inputs, run the pure engine over them,
 * cache the result, and hand back an object that carries its own statement of
 * what it is. Everything it composes — `EventNormalizer`,
 * `PlayerPositionMapper`, `HeatmapAggregator`, `HeatmapCache` — is independently
 * testable without it, which is the point of splitting them.
 *
 * ## It spends no provider quota. At all.
 *
 * Every input is read from KIVO's own tables — `lineups`, `fixture_events`,
 * `fixture_player_statistics` — all of which are populated by the existing sync
 * pipeline under its existing quota guards. Somebody opening a Match Centre tab
 * can never cause a provider request from here. That is deliberate: a
 * page-view-triggered fetch on a 100-requests-a-day budget is how a daily quota
 * disappears in an afternoon, and `auto-sync.ts` already exists to make that
 * decision carefully in one place.
 *
 * The consequence is that the heatmap is exactly as good as what has been
 * synced, and says so — a fixture with a lineup but no per-player statistics
 * gets a shape built from formation and timeline events, and the caption names
 * those as its basis.
 */
export class HeatmapService {
  private readonly cache: HeatmapCache;

  constructor(private readonly supabase: ServiceClient) {
    this.cache = new HeatmapCache(supabase);
  }

  /**
   * Everything needed to render one fixture's heatmaps, for one period.
   *
   * Returns null only when the fixture itself cannot be read. A fixture with
   * nothing synced returns a real, empty result — `hasContent: false` — because
   * "KIVO has nothing for this match" is an answer, not a failure.
   */
  async getFixtureHeatmaps(
    fixtureId: string,
    period: CachePeriod = "full-match",
  ): Promise<FixtureHeatmapPayload | null> {
    const [fixtureResult, lineupResult, eventResult, statisticsResult] = await Promise.all([
      this.supabase.from("fixtures").select("id, home_team_id, away_team_id, status").eq("id", fixtureId).maybeSingle(),
      this.supabase
        .from("lineups")
        .select("team_id, player_id, is_starting, shirt_number, position, formation, grid, player:players(full_name, known_as)")
        .eq("fixture_id", fixtureId),
      this.supabase
        .from("fixture_events")
        .select("team_id, player_id, event_type, minute, added_time")
        .eq("fixture_id", fixtureId),
      this.supabase
        .from("fixture_player_statistics")
        .select(
          "player_id, team_id, minutes_played, shots_total, shots_on_target, goals, assists, saves, passes_total, passes_key, tackles_total, blocks, interceptions, duels_total, duels_won, dribbles_attempted, dribbles_succeeded, fouls_drawn, fouls_committed, updated_at",
        )
        .eq("fixture_id", fixtureId),
    ]);

    if (fixtureResult.error || !fixtureResult.data) {
      if (fixtureResult.error) logError("football.heatmap.loadFixture", fixtureResult.error, { fixtureId });
      return null;
    }
    const fixture = fixtureResult.data;

    // A failed read of any one input degrades the shape rather than the page:
    // a missing statistics table gives a formation-and-events heatmap, which is
    // exactly what a fixture that has never had statistics synced produces
    // anyway. It is logged so the difference is visible in a log rather than
    // only in a thinner picture.
    if (lineupResult.error) logError("football.heatmap.loadLineups", lineupResult.error, { fixtureId });
    if (eventResult.error) logError("football.heatmap.loadEvents", eventResult.error, { fixtureId });
    if (statisticsResult.error) logError("football.heatmap.loadPlayerStatistics", statisticsResult.error, { fixtureId });

    const lineups: HeatmapLineupInput[] = (lineupResult.data ?? []).map((row) => ({
      teamId: row.team_id,
      playerId: row.player_id,
      playerName: row.player?.known_as ?? row.player?.full_name ?? "Unknown player",
      isStarting: row.is_starting,
      position: row.position,
      formation: row.formation,
      shirtNumber: row.shirt_number,
      grid: row.grid,
    }));

    const events: MatchEventInput[] = (eventResult.data ?? []).map((row) => ({
      teamId: row.team_id,
      playerId: row.player_id,
      eventType: row.event_type,
      minute: row.minute,
      addedTime: row.added_time,
    }));

    const playerStatistics: PlayerMatchStatisticsInput[] = (statisticsResult.data ?? []).map((row) => ({
      playerId: row.player_id,
      teamId: row.team_id,
      minutesPlayed: row.minutes_played,
      shotsTotal: row.shots_total,
      shotsOnTarget: row.shots_on_target,
      goals: row.goals,
      assists: row.assists,
      saves: row.saves,
      passesTotal: row.passes_total,
      passesKey: row.passes_key,
      tacklesTotal: row.tackles_total,
      blocks: row.blocks,
      interceptions: row.interceptions,
      duelsTotal: row.duels_total,
      duelsWon: row.duels_won,
      dribblesAttempted: row.dribbles_attempted,
      dribblesSucceeded: row.dribbles_succeeded,
      foulsDrawn: row.fouls_drawn,
      foulsCommitted: row.fouls_committed,
    }));

    // No `observations` argument: no PositionalDataProvider is implemented
    // anywhere in KIVO, so there is nothing real to pass. Passing an empty array
    // explicitly would suggest a source that was consulted and had nothing;
    // omitting it says the source does not exist, which is the truth.
    const set = buildFixtureHeatmaps({
      fixtureId,
      homeTeamId: fixture.home_team_id,
      awayTeamId: fixture.away_team_id,
      lineups,
      events,
      playerStatistics,
    });

    const fingerprint = fingerprintHeatmapInputs({
      lineups,
      events,
      playerStatistics: (statisticsResult.data ?? []).map((row) => ({
        playerId: row.player_id,
        minutesPlayed: row.minutes_played,
        updatedAt: row.updated_at,
      })),
    });

    const subjects = [...set.home.players, ...set.away.players];
    const cached = await this.cache.read(fixtureId, period, fingerprint);

    const heatmaps: Record<string, AggregatedHeatmap> = {};
    const toPersist: Parameters<HeatmapCache["write"]>[0][number][] = [];

    for (const subject of subjects) {
      const hit = cached.get(subject.playerId);
      if (hit) {
        heatmaps[subject.playerId] = {
          grid: hit.grid,
          derivation: hit.derivation,
          // A cached row exists only for a subject that produced one; the empty
          // grid of an unanchored player is never written, so a hit always has
          // data. Recomputed from the grid rather than stored as a column so the
          // two can never disagree.
          hasData: hit.grid.maxZoneWeight > 0,
          totalActions: hit.total_actions,
          classMix: hit.class_mix,
          sourcesUsed: hit.sources,
          actionsWithoutPeriod: hit.actions_without_period,
        };
        continue;
      }

      const built = buildPlayerHeatmap(subject, { period });
      heatmaps[subject.playerId] = built;
      if (built.hasData) {
        toPersist.push({
          fixtureId,
          playerId: subject.playerId,
          teamId: subject.teamId,
          period,
          heatmap: built,
          anchor: subject.anchor,
          fingerprint,
        });
      }
    }

    // Only a settled fixture is written back. A live match's inputs change every
    // few minutes, so caching it would mean a row per goal per player — churn
    // for an answer that is about to be wrong anyway. The computation is cheap;
    // the write is the part worth being careful with.
    if (toPersist.length > 0 && FINAL_STATUSES.has(fixture.status)) {
      await this.cache.write(toPersist);
    }

    return {
      set,
      period,
      heatmaps,
      hasContent: subjects.some((subject) => subject.anchor !== null),
      /** True when the shape had per-player statistics to work from, rather than
       * only the team sheet and the timeline. Drives the caption's basis line. */
      usedPlayerStatistics: playerStatistics.length > 0,
      cached: cached.size > 0,
    };
  }
}

/** Statuses after which a fixture's inputs stop changing, so its heatmap is
 * worth persisting. Deliberately excludes `live` and `halftime`. */
const FINAL_STATUSES = new Set<Database["public"]["Enums"]["fixture_status"]>([
  "finished",
  "abandoned",
  "cancelled",
  "postponed",
]);

export type FixtureHeatmapPayload = {
  set: FixtureHeatmapSet;
  period: CachePeriod;
  /** Player id -> that player's grid for `period`. */
  heatmaps: Record<string, AggregatedHeatmap>;
  hasContent: boolean;
  usedPlayerStatistics: boolean;
  cached: boolean;
};

export type { PlayerHeatmapSubject };

/** Convenience for callers that have no client to hand. Uses the service-role
 * client because `player_heatmaps` writes are admin-gated at the RLS layer, the
 * same way every other pipeline-written football table is. */
export function createHeatmapService(): HeatmapService {
  return new HeatmapService(createServiceRoleSupabaseClient());
}
