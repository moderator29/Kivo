import { resultFor, type FormResult } from "./results";

/**
 * KIVO Form Engine — reusable W/D/L + goal-trend computation for a team or a
 * player over a real window of already-synced, finished fixtures. Pulled out
 * of the ad hoc "last 5" logic that existed only inline in
 * `src/app/(app)/teams/[id]/page.tsx` (`recentForm`) so every consumer (team
 * pages, player pages, the AI Copilot's grounding context) shares one
 * definition instead of re-deriving W/D/L from scores independently.
 *
 * Everything here is pure and DB-client-free, same convention as
 * `results.ts` and `player-stats.ts` — callers do the Supabase query and
 * resolve each fixture to "own score vs opponent score" first (they already
 * know which side is home/away), this module only aggregates.
 */

export type FormWindow = "last5" | "last10" | "season";

export const FORM_WINDOW_LABEL: Record<FormWindow, string> = {
  last5: "Last 5",
  last10: "Last 10",
  season: "Season",
};

/** How many of the caller's newest-first results each windowed form uses.
 * "season" has no fixed size — it uses every finished result the caller
 * passed in. */
export const FORM_WINDOW_SIZE: Record<"last5" | "last10", number> = {
  last5: 5,
  last10: 10,
};

/**
 * Below this many real finished matches, a W/D/L "form" figure is more noise
 * than signal — every function below refuses to present a trend as reliable
 * under this threshold (via `isSufficientSample: false`) rather than quietly
 * computing one from 0 or 1 data points. Per the standing rule: honest
 * "insufficient data" beats a plausible-looking number from too small a
 * sample.
 */
export const MIN_FORM_SAMPLE = 2;

/**
 * One finished fixture already resolved to a single side's perspective —
 * "own" is whichever team/player the caller is computing form for. Callers
 * building this from the raw `fixtures` table can pass `home_team_id`/
 * `away_team_id` (real columns) straight through `resolveFixtureResult`
 * below instead of hand-rolling the isHome check themselves.
 */
export type ResolvedResult = {
  fixtureId: string;
  kickoffAt: string;
  ownScore: number;
  oppScore: number;
};

export type FormSummary = {
  window: FormWindow;
  windowLabel: string;
  /** Real number of finished fixtures this summary was actually computed
   * from — may be smaller than the window's nominal size (e.g. "last5" for
   * a team with only 3 finished matches synced). */
  sampleSize: number;
  isSufficientSample: boolean;
  minSampleRequired: number;
  /** Newest match first — matches the existing convention already used by
   * `FormBadges` / `teams/[id]/page.tsx`'s `recentForm` (leftmost badge is
   * the most recent result). */
  sequence: FormResult[];
  wins: number;
  draws: number;
  losses: number;
  goalsScored: number;
  goalsConceded: number;
  goalDifference: number;
  points: number;
  pointsPerMatch: number | null;
};

function summarize(window: FormWindow, results: ResolvedResult[]): FormSummary {
  const sampleSize = results.length;
  const sequence: FormResult[] = [];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsScored = 0;
  let goalsConceded = 0;

  for (const r of results) {
    goalsScored += r.ownScore;
    goalsConceded += r.oppScore;
    const result = resultFor(r.ownScore, r.oppScore);
    sequence.push(result);
    if (result === "W") wins += 1;
    else if (result === "D") draws += 1;
    else losses += 1;
  }

  const points = wins * 3 + draws;

  return {
    window,
    windowLabel: FORM_WINDOW_LABEL[window],
    sampleSize,
    isSufficientSample: sampleSize >= MIN_FORM_SAMPLE,
    minSampleRequired: MIN_FORM_SAMPLE,
    sequence,
    wins,
    draws,
    losses,
    goalsScored,
    goalsConceded,
    goalDifference: goalsScored - goalsConceded,
    points,
    pointsPerMatch: sampleSize > 0 ? Math.round((points / sampleSize) * 100) / 100 : null,
  };
}

/**
 * Team form over a given window. `resultsNewestFirst` must already be
 * resolved to this team's own perspective and sorted newest-first (the
 * caller's Supabase query already orders by `kickoff_at` descending for the
 * "Recent results" list this generalizes — see `teams/[id]/page.tsx`).
 * "last5"/"last10" take the first N of the input; "season" uses every row
 * passed in, so the caller decides how far back "season" reaches by how many
 * rows it fetches (e.g. scoped to the current season's fixtures only).
 */
export function computeTeamForm(resultsNewestFirst: ResolvedResult[], window: FormWindow): FormSummary {
  const windowed = window === "season" ? resultsNewestFirst : resultsNewestFirst.slice(0, FORM_WINDOW_SIZE[window]);
  return summarize(window, windowed);
}

/**
 * Player form over a given window. Same computation as team form, but the
 * caller resolves each fixture's "own"/"opponent" score against the
 * player's team on the day (from that player's `lineups` row), not the
 * player individually — there is no per-player W/D/L in football, only a
 * team result the player shared in. This reflects team form during matches
 * the player was named in the squad for, not an individual match rating
 * (see `rating-engine.ts` for the latter, which scores the player, not
 * their team's result).
 */
export function computePlayerForm(resultsNewestFirst: ResolvedResult[], window: FormWindow): FormSummary {
  return computeTeamForm(resultsNewestFirst, window);
}

/** Minimal shape of a `fixtures` row needed to resolve one side's result —
 * every field here is a real column on the `fixtures` table (see
 * `src/lib/supabase/types.ts`), not a derived/joined one, so callers can
 * select it directly without a nested team join just for this. */
export type FixtureResultRow = {
  id: string;
  kickoff_at: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
};

/**
 * Resolves one fixture to `teamId`'s own-vs-opponent perspective. Returns
 * null for anything that isn't a real, scored, finished result for this team
 * (wrong team, not finished yet, or a finished fixture somehow missing a
 * score) — callers filter these out rather than treating them as a 0-0 or
 * skipping silently in a way that would miscount the sample size.
 */
export function resolveFixtureResult(fixture: FixtureResultRow, teamId: string): ResolvedResult | null {
  if (fixture.status !== "finished") return null;
  if (fixture.home_score === null || fixture.away_score === null) return null;
  const isHome = fixture.home_team_id === teamId;
  const isAway = fixture.away_team_id === teamId;
  if (!isHome && !isAway) return null;

  return {
    fixtureId: fixture.id,
    kickoffAt: fixture.kickoff_at,
    ownScore: isHome ? fixture.home_score : fixture.away_score,
    oppScore: isHome ? fixture.away_score : fixture.home_score,
  };
}
