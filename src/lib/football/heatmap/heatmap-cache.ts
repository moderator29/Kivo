import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import type { AggregatedHeatmap } from "./heatmap-aggregator";
import type { MatchPeriod } from "./event-normalizer";
import type { PositionAnchor } from "./player-position-mapper";

type ServiceClient = SupabaseClient<Database>;

/** The period key a cached row is stored under. */
export type CachePeriod = MatchPeriod | "full-match";

/**
 * Bumped whenever the derivation model changes in a way that would produce a
 * different shape from the same inputs — a new class offset, a different sigma,
 * a change to how an anchor is placed.
 *
 * Rows written by an older version are ignored and regenerated rather than
 * migrated. That matters more here than in a normal cache: a stale heatmap is
 * not a stale number, it is a stale PICTURE of where somebody played, and there
 * is no way for a reader to tell one model's output from another's by looking.
 */
export const HEATMAP_ENGINE_VERSION = 1;

/**
 * `HeatmapCache` — the fifth of the five services.
 *
 * ## What is actually being saved
 *
 * Two different costs, and it is worth being precise about which:
 *
 *   * **Provider quota.** The per-player match statistics that make a derived
 *     shape richer than goals-and-cards cost a request. Persisting the result
 *     means a fixture that has been looked at once never needs that request
 *     again — which on a 100-requests-a-day free tier is the difference between
 *     the feature being affordable and not.
 *   * **Computation.** A fixture is twenty-two players; a grid is a Gaussian
 *     sum over forty-two zones per player per period. Recomputing that on every
 *     tab switch is work nobody needs done twice.
 *
 * ## Invalidated by inputs, never by a clock
 *
 * A TTL would be wrong in both directions here. A finished fixture's shape is
 * as true next year as it was on the night, so expiring it would spend work to
 * recompute an identical answer. A live fixture's shape changes with every
 * goal, so any TTL long enough to be useful is long enough to be wrong.
 *
 * So the key is a fingerprint of the inputs. If the lineup, the events and the
 * player statistics that fed a row are unchanged, the row is still correct. If
 * any of them changed, the fingerprint changes and the row is ignored.
 */
export class HeatmapCache {
  constructor(private readonly supabase: ServiceClient) {}

  /**
   * Reads every cached grid for one fixture and period, keyed by player id.
   *
   * Rows from a different engine version or a different input fingerprint are
   * filtered out here rather than in SQL, so one query serves the check and the
   * read, and so a stale row can be counted for logging rather than silently
   * missing.
   *
   * A read failure is not an error worth failing a page for: the caller simply
   * computes what it would have computed anyway. It is logged, and an empty map
   * is returned.
   */
  async read(
    fixtureId: string,
    period: CachePeriod,
    fingerprint: string,
  ): Promise<Map<string, CachedHeatmapRow>> {
    const { data, error } = await this.supabase
      .from("player_heatmaps")
      .select(
        "player_id, team_id, period, derivation, grid, total_actions, actions_without_period, class_mix, anchor, sources, engine_version, inputs_fingerprint, generated_at",
      )
      .eq("fixture_id", fixtureId)
      .eq("period", period);

    if (error) {
      logError("football.heatmap.cacheRead", error, { fixtureId, period });
      return new Map();
    }

    const fresh = new Map<string, CachedHeatmapRow>();
    for (const row of data ?? []) {
      if (row.engine_version !== HEATMAP_ENGINE_VERSION) continue;
      if (row.inputs_fingerprint !== fingerprint) continue;
      fresh.set(row.player_id, row as unknown as CachedHeatmapRow);
    }
    return fresh;
  }

  /**
   * Persists a fixture's grids for one period.
   *
   * Upserted on (fixture_id, player_id, period), so re-running is idempotent and
   * a changed fingerprint replaces the stale row rather than accumulating
   * alongside it — a cache that grows a row per model revision would quietly
   * become the largest table in the database.
   *
   * Writing never fails a caller. The grids were already computed and are
   * already being returned; a failed write means the next reader recomputes
   * them, which is exactly what would have happened with no cache at all.
   */
  async write(rows: readonly HeatmapCacheWrite[]): Promise<void> {
    if (rows.length === 0) return;

    const payload = rows.map((row) => ({
      fixture_id: row.fixtureId,
      player_id: row.playerId,
      team_id: row.teamId,
      period: row.period,
      derivation: row.heatmap.derivation,
      grid: row.heatmap.grid as unknown as Database["public"]["Tables"]["player_heatmaps"]["Insert"]["grid"],
      total_actions: row.heatmap.totalActions,
      actions_without_period: row.heatmap.actionsWithoutPeriod,
      class_mix: row.heatmap.classMix as unknown as Database["public"]["Tables"]["player_heatmaps"]["Insert"]["class_mix"],
      anchor: (row.anchor ?? null) as unknown as Database["public"]["Tables"]["player_heatmaps"]["Insert"]["anchor"],
      sources: row.heatmap.sourcesUsed,
      engine_version: HEATMAP_ENGINE_VERSION,
      inputs_fingerprint: row.fingerprint,
      generated_at: new Date().toISOString(),
    }));

    const { error } = await this.supabase
      .from("player_heatmaps")
      .upsert(payload, { onConflict: "fixture_id,player_id,period" });

    if (error) logError("football.heatmap.cacheWrite", error, { count: rows.length });
  }
}

export type CachedHeatmapRow = {
  player_id: string;
  team_id: string;
  period: CachePeriod;
  derivation: "tracked" | "derived";
  grid: AggregatedHeatmap["grid"];
  total_actions: number;
  actions_without_period: number;
  class_mix: AggregatedHeatmap["classMix"];
  anchor: PositionAnchor | null;
  sources: string[];
  engine_version: number;
  inputs_fingerprint: string;
  generated_at: string;
};

export type HeatmapCacheWrite = {
  fixtureId: string;
  playerId: string;
  teamId: string;
  period: CachePeriod;
  heatmap: AggregatedHeatmap;
  anchor: PositionAnchor | null;
  fingerprint: string;
};

/**
 * A stable digest of everything a fixture's heatmaps were built from.
 *
 * The inputs are reduced to their identifying fields and sorted before hashing,
 * so the fingerprint depends on the DATA and not on the order Postgres happened
 * to return rows in — an unsorted digest would change on almost every read and
 * make the cache a write-only table that never hits.
 *
 * The engine version is folded in as well, so a model change invalidates every
 * row even for a fixture whose inputs are frozen.
 */
export function fingerprintHeatmapInputs(input: {
  lineups: readonly { playerId: string; isStarting: boolean; position: string | null; grid?: string | null }[];
  events: readonly { playerId: string | null; eventType: string; minute: number }[];
  playerStatistics: readonly { playerId: string; minutesPlayed?: number | null; updatedAt?: string | null }[];
}): string {
  const parts = [
    `v${HEATMAP_ENGINE_VERSION}`,
    ...input.lineups
      .map((l) => `L:${l.playerId}:${l.isStarting ? 1 : 0}:${l.position ?? ""}:${l.grid ?? ""}`)
      .sort(),
    ...input.events.map((e) => `E:${e.playerId ?? ""}:${e.eventType}:${e.minute}`).sort(),
    // A statistics row is identified by its own updated_at rather than by every
    // number on it: the provider rewrites the whole row when anything changes,
    // and hashing thirty columns per player to detect that would cost more than
    // it saves.
    ...input.playerStatistics.map((s) => `S:${s.playerId}:${s.minutesPlayed ?? ""}:${s.updatedAt ?? ""}`).sort(),
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}
