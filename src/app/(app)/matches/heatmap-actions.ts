"use server";

import { getOrCreateProfile } from "@/lib/profile";
import { logError } from "@/lib/log";
import { createHeatmapService } from "@/lib/football/heatmap/heatmap-service";
import type { AggregatedHeatmap } from "@/lib/football/heatmap/heatmap-aggregator";
import type { CachePeriod } from "@/lib/football/heatmap/heatmap-cache";

const PERIODS: readonly CachePeriod[] = ["full-match", "first-half", "second-half", "extra-time"];

export type LoadFixtureHeatmapsResult = {
  /** Player id -> that player's grid for the requested period. */
  heatmaps: Record<string, AggregatedHeatmap>;
  /** True when per-player match statistics fed the shapes, rather than only the
   * team sheet and the goals/cards timeline. The caption says which. */
  usedPlayerStatistics: boolean;
};

/**
 * The server-side upgrade behind `HeatmapView`.
 *
 * Match Centre is a client component and already holds a fixture's lineups and
 * events, so it can build a real heatmap on its own — and does, before this is
 * ever called. What it cannot see is the provider's formation-slot `grid`
 * (which sharpens every anchor) or `fixture_player_statistics` (which turns a
 * goals-and-cards shape into one built from a player's whole involvement).
 * Those are what this returns.
 *
 * It is strictly additive. If it fails, is unavailable, or returns nothing, the
 * view keeps rendering the baseline it was handed — so this can never turn a
 * visible tab into an empty one.
 *
 * **It spends no provider quota.** Every input is read from KIVO's own tables.
 * A page view can never cause a provider request from here; that decision lives
 * in `auto-sync.ts`, deliberately, in one place, behind a cooldown and a quota
 * floor. See `HeatmapService`.
 */
export async function loadFixtureHeatmaps(
  fixtureId: string,
  period: CachePeriod = "full-match",
): Promise<LoadFixtureHeatmapsResult | null> {
  // The whole (app) route group is gated, and this reads only football
  // reference data — but a server action is its own entry point, reachable
  // without ever rendering the page that calls it, so it checks rather than
  // assumes. Returning null (not an error) keeps the caller's degradation path
  // the same for "signed out" as for "nothing to show".
  const profile = await getOrCreateProfile();
  if (!profile) return null;

  if (!PERIODS.includes(period)) return null;
  // Cheap shape check before anything touches the database: this id arrives
  // from a client component, and an id-shaped argument that is not an id should
  // not become a query.
  if (!/^[0-9a-f-]{36}$/i.test(fixtureId)) return null;

  try {
    const payload = await createHeatmapService().getFixtureHeatmaps(fixtureId, period);
    if (!payload) return null;
    return { heatmaps: payload.heatmaps, usedPlayerStatistics: payload.usedPlayerStatistics };
  } catch (error) {
    logError("football.heatmap.loadFixtureHeatmaps", error, { fixtureId, period });
    return null;
  }
}
