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
export type LiveFixtureFact = { season_id: string; kickoff_at: string };
export type GameweekFact = { id: string; season_id: string; deadline_at: string };

/**
 * The gameweeks that the fixtures currently in play actually belong to.
 *
 * This used to read `is_current`, and that was wrong in a way only real data
 * shows. `is_current` is set by generateFantasyGameweeks to the earliest
 * gameweek whose DEADLINE is still in the future, and a gameweek's deadline is
 * its own first kickoff — so from the moment Saturday's first match kicks off,
 * the "current" gameweek is next week's. Re-scoring only that one meant live
 * points never touched the gameweek whose matches were being played: the run
 * reported success every minute, having scored a gameweek with no finished
 * fixtures in it, while the totals a manager was watching never moved.
 *
 * A gameweek owns a fixture when it is the latest gameweek in that season
 * whose deadline is at or before the fixture's kickoff — the same "deadline is
 * the first kickoff" relationship, read in the direction that answers the
 * question being asked. Returned in deadline order so the cap below takes the
 * oldest in-play gameweek first; a manager waiting on a result that finished
 * an hour ago is worse served than one whose match is still on.
 */
export function gameweeksOwningFixtures(
  fixtures: LiveFixtureFact[],
  gameweeks: GameweekFact[],
): string[] {
  const bySeason = new Map<string, GameweekFact[]>();
  for (const gameweek of gameweeks) {
    const list = bySeason.get(gameweek.season_id) ?? [];
    list.push(gameweek);
    bySeason.set(gameweek.season_id, list);
  }
  for (const list of bySeason.values()) {
    list.sort((a, b) => a.deadline_at.localeCompare(b.deadline_at));
  }

  const owning = new Map<string, string>();
  for (const fixture of fixtures) {
    const seasonGameweeks = bySeason.get(fixture.season_id);
    if (!seasonGameweeks) continue;
    let owner: GameweekFact | null = null;
    for (const gameweek of seasonGameweeks) {
      if (gameweek.deadline_at <= fixture.kickoff_at) owner = gameweek;
      else break;
    }
    // A fixture earlier than every deadline in its season belongs to the first
    // gameweek: the deadline is the first kickoff, so this is a fixture that
    // moved earlier after the gameweeks were generated, not an orphan.
    owner ??= seasonGameweeks[0] ?? null;
    if (owner) owning.set(owner.id, owner.deadline_at);
  }

  return [...owning.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id);
}

/** Gameweeks whose every stored total already says `final`. */
export function settledGameweekIds(totals: { gameweek_id: string; status: string }[]): Set<string> {
  const byGameweek = new Map<string, boolean>();
  for (const total of totals) {
    const stillSettled = byGameweek.get(total.gameweek_id);
    const isFinal = total.status === "final";
    byGameweek.set(total.gameweek_id, stillSettled === undefined ? isFinal : stillSettled && isFinal);
  }
  return new Set([...byGameweek.entries()].filter(([, settled]) => settled).map(([id]) => id));
}

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

  const { data: gameweeks, error: gameweeksError } = await supabase
    .from("fantasy_gameweeks")
    .select("id, season_id, deadline_at")
    .in("season_id", seasonIds);

  if (gameweeksError) {
    logError("fantasy.liveScoring.gameweeks", gameweeksError);
    return { gameweeksScored: 0, gameweeksDeferred: 0 };
  }

  const candidateIds = gameweeksOwningFixtures(activeFixtures ?? [], gameweeks ?? []);
  if (candidateIds.length === 0) return { gameweeksScored: 0, gameweeksDeferred: 0 };

  // A gameweek whose stored total already says `final` is settled, and
  // migration 0095 exists to stop a background job silently recomputing a
  // settled score. Re-scoring one is an admin's deliberate act, not this
  // function's. Anything still provisional is by definition unsettled, which
  // is exactly what this function is for.
  const { data: storedTotals, error: totalsError } = await supabase
    .from("fantasy_points")
    .select("gameweek_id, status")
    .in("gameweek_id", candidateIds);

  if (totalsError) {
    logError("fantasy.liveScoring.storedTotals", totalsError);
    return { gameweeksScored: 0, gameweeksDeferred: 0 };
  }

  const settled = settledGameweekIds(storedTotals ?? []);
  const targets = candidateIds.filter((id) => !settled.has(id)).map((id) => ({ id }));
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
