import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import { runGameweekScoring } from "@/lib/fantasy-gameweek-scoring";

type ServiceClient = SupabaseClient<Database>;

/**
 * Fantasy points that move during a match.
 *
 * ## Why this is possible now and was not before
 *
 * Two things had to exist first, and neither is here. The live worker
 * (`scheduled-sync.ts`) is what puts real events into `fixture_events` while a
 * match is being played; before it, nothing wrote during a match and there was
 * nothing to re-score. And migration 0095's completeness columns are what let a
 * mid-match total say what it is — a score that moves and does not admit it is
 * provisional is worse than one that does not move at all, because a manager
 * reading 61 has no way to know it is 61-so-far.
 *
 * So live points needed no new scoring machinery. It is the existing scorer,
 * called more often, over data that is already arriving, producing rows that
 * already carry `status = 'provisional'` and the fixture counts that explain
 * why. The scorecard renders those without knowing or caring that a match is in
 * progress.
 *
 * ## It costs nothing against the provider
 *
 * Every input is read from KIVO's own tables. This runs AFTER a live sync has
 * already spent its budgeted request, and adds no provider call of its own —
 * which is the only reason it can run as often as the worker does.
 */

/**
 * How far back to look for a season worth re-scoring.
 *
 * A match that kicked off four hours ago is over, and its events have had time
 * to arrive; anything older belongs to the daily pass rather than to a live
 * one. Deliberately generous rather than tight: the cost of including a season
 * that has nothing new is one wasted database read, and the cost of excluding
 * one is a manager watching a score that never updates.
 */
const LIVE_LOOKBACK_HOURS = 4;

/**
 * How many gameweeks one invocation will re-score.
 *
 * This is database work, not provider work, but it is not free: each gameweek
 * re-scores every roster in it. Bounded so a Saturday with a dozen leagues in
 * play cannot turn a once-a-minute worker into a long-running job that outlives
 * its own lease. Whatever is not covered is picked up on the next firing, a
 * minute later.
 */
const MAX_GAMEWEEKS_PER_RUN = 3;

export type LiveScoringResult = {
  gameweeksScored: number;
  /** Gameweeks that were considered but not reached because of the cap — a
   * real number rather than a silence, so a Saturday backlog is visible. */
  gameweeksDeferred: number;
};

/**
 * Re-scores the current gameweek of every season with a match in play or just
 * finished.
 *
 * Best-effort throughout, by contract: this runs after the sync that actually
 * matters has already succeeded, and a fantasy scoring failure must never make
 * a successful fixtures sync report itself as broken. Every failure is logged
 * and the run continues to the next gameweek.
 */
export async function rescoreLiveGameweeks(supabase: ServiceClient): Promise<LiveScoringResult> {
  const since = new Date(Date.now() - LIVE_LOOKBACK_HOURS * 60 * 60_000).toISOString();

  const { data: activeFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("season_id, status, kickoff_at")
    .gte("kickoff_at", since)
    .in("status", ["live", "halftime", "finished"])
    .limit(200);

  if (fixturesError) {
    logError("fantasy.liveScoring.fixtures", fixturesError);
    return { gameweeksScored: 0, gameweeksDeferred: 0 };
  }

  const seasonIds = [...new Set((activeFixtures ?? []).map((fixture) => fixture.season_id))];
  if (seasonIds.length === 0) return { gameweeksScored: 0, gameweeksDeferred: 0 };

  // Only the CURRENT gameweek of each season. Re-scoring a past gameweek here
  // would be the thing migration 0095 exists to prevent: a settled score
  // silently recomputed by a background job nobody asked. Past gameweeks are
  // re-scored only when an admin deliberately asks for it.
  const { data: gameweeks, error: gameweeksError } = await supabase
    .from("fantasy_gameweeks")
    .select("id, season_id")
    .in("season_id", seasonIds)
    .eq("is_current", true);

  if (gameweeksError) {
    logError("fantasy.liveScoring.gameweeks", gameweeksError);
    return { gameweeksScored: 0, gameweeksDeferred: 0 };
  }

  const targets = gameweeks ?? [];
  const batch = targets.slice(0, MAX_GAMEWEEKS_PER_RUN);

  let scored = 0;
  for (const gameweek of batch) {
    try {
      const result = await runGameweekScoring(gameweek.id);
      if (result.error) {
        // Includes the deliberate refusal when no stored ruleset matches the
        // scoring version — which must be loud in a log rather than retried
        // silently every minute.
        logError("fantasy.liveScoring.score", result.error, { gameweekId: gameweek.id });
        continue;
      }
      scored += 1;
    } catch (error) {
      logError("fantasy.liveScoring.score", error, { gameweekId: gameweek.id });
    }
  }

  return { gameweeksScored: scored, gameweeksDeferred: Math.max(0, targets.length - batch.length) };
}
