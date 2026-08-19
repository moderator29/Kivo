"use server";

import { getOrCreateProfile } from "@/lib/profile";
import { logError } from "@/lib/log";
import { createHeatmapService } from "@/lib/football/heatmap/heatmap-service";
import type { AggregatedHeatmap } from "@/lib/football/heatmap/heatmap-aggregator";
import type { CachePeriod } from "@/lib/football/heatmap/heatmap-cache";

const PERIODS: readonly CachePeriod[] = ["full-match", "first-half", "second-half", "extra-time"];

/**
 * Three outcomes, deliberately, because two of them are ordinary and one is not.
 *
 * `unavailable` is the normal path whenever there is simply no richer version to
 * fetch — a signed-out caller, a fixture KIVO does not hold, an argument that is
 * not an id. `error` means KIVO tried and something broke. Collapsing them into
 * one null made the view say "a richer version couldn't be loaded just now" in
 * the perfectly ordinary case, which reads as a fault when nothing is at fault.
 * The reader should only be told something went wrong when something did.
 */
export type LoadFixtureHeatmapsResult =
  | {
      status: "ok";
      /** Player id -> that player's grid for the requested period. */
      heatmaps: Record<string, AggregatedHeatmap>;
      /** True when per-player match statistics fed the shapes, rather than only
       * the team sheet and the goals/cards timeline. The caption says which. */
      usedPlayerStatistics: boolean;
    }
  | { status: "unavailable" }
  | { status: "error" };

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
): Promise<LoadFixtureHeatmapsResult> {
  // The whole (app) route group is gated, and this reads only football
  // reference data — but a server action is its own entry point, reachable
  // without ever rendering the page that calls it, so it checks rather than
  // assumes.
  const profile = await getOrCreateProfile();
  if (!profile) return { status: "unavailable" };

  if (!PERIODS.includes(period)) return { status: "unavailable" };
  // Cheap shape check before anything touches the database: this id arrives
  // from a client component, and an id-shaped argument that is not an id should
  // not become a query.
  if (!/^[0-9a-f-]{36}$/i.test(fixtureId)) return { status: "unavailable" };

  try {
    const payload = await createHeatmapService().getFixtureHeatmaps(fixtureId, period);
    if (!payload) return { status: "unavailable" };
    return {
      status: "ok",
      heatmaps: payload.heatmaps,
      usedPlayerStatistics: payload.usedPlayerStatistics,
    };
  } catch (error) {
    logError("football.heatmap.loadFixtureHeatmaps", error, { fixtureId, period });
    return { status: "error" };
  }
}
