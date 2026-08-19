import { computePlayerMatchRating, type PlayerMatchRating } from "./rating-engine";
import type { TeamSheet, TeamSheetPlayer } from "./team-sheet";

/**
 * The bridge between a built team sheet and `rating-engine.ts`.
 *
 * The rating engine has existed, tested and documented (`docs/RATING_ENGINE.md`),
 * since before this pass and nothing in the product ever called it. This module
 * is the adapter that does — it takes the counts a `TeamSheet` already holds
 * (real `fixture_events` rows) plus the fixture's real final score, and returns
 * one rating per player, or null for every player the engine honestly refuses
 * to rate.
 *
 * ## The honesty rules this inherits, and does not relax
 *
 *  - Only a **finished** fixture is rated. A live match has no final score, so
 *    the clean-sheet and goals-conceded terms would be guesses.
 *  - A player with no evidence of involvement (an unused substitute) gets
 *    `null`, never a baseline number.
 *  - Every value is KIVO's own model output and is labelled as such wherever it
 *    is shown. `providerRating` stays null because API-Football's free tier
 *    publishes no ratings at all — the two are never blended or relabelled.
 *
 * Pure and DB-free, same as `team-sheet.ts`, so both the server page and the
 * client tab can use it and it can be tested without a database.
 */

export type FixtureSideResult = {
  fixtureId: string;
  fixtureStatus: string;
  /** This side's own final score, and its opponent's. Null before full time. */
  goalsFor: number | null;
  goalsAgainst: number | null;
};

export type RatedTeamSheetPlayer = {
  player: TeamSheetPlayer;
  /** Null whenever the engine declined to rate — see this module's doc. */
  rating: PlayerMatchRating | null;
};

/**
 * Rates every named player on one team sheet, starters and bench alike, in
 * the sheet's own order.
 */
export function rateTeamSheet(sheet: TeamSheet, result: FixtureSideResult): RatedTeamSheetPlayer[] {
  return [...sheet.starters, ...sheet.bench].map((player) => ({
    player,
    rating: computePlayerMatchRating({
      playerId: player.playerId,
      fixtureId: result.fixtureId,
      fixtureStatus: result.fixtureStatus,
      position: player.position,
      isStarting: player.isStarting,
      cameOnFromBench: player.cameOn !== null,
      goals: player.goals,
      assists: player.assists,
      ownGoals: player.ownGoals,
      yellowCards: player.yellowCards,
      redCards: player.redCards,
      teamGoalsFor: result.goalsFor,
      teamGoalsAgainst: result.goalsAgainst,
    }),
  }));
}

/** playerId -> KIVO rating, for the tokens on the pitch and the bench rows.
 * Players the engine declined to rate are simply absent from the map. */
export function ratingsByPlayerId(rated: RatedTeamSheetPlayer[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const entry of rated) {
    if (entry.rating && entry.player.playerId) map.set(entry.player.playerId, entry.rating.kivoRating);
  }
  return map;
}

export type StandoutPlayer = {
  player: TeamSheetPlayer;
  rating: PlayerMatchRating;
  teamId: string;
};

/**
 * KIVO's own pick of the match, from both sides' rated players.
 *
 * Returns null unless there is a single unambiguous top rating. A tie is a
 * genuine outcome of a model built on a small set of countable events — two
 * players who each scored once from the same position rate identically — and
 * naming one of them would be arbitrary rather than analytical. The Match
 * Centre then shows the ranked list without crowning anybody, which is the
 * honest rendering of "the model does not separate these two".
 */
export function pickStandoutPlayer(
  sides: { teamId: string; rated: RatedTeamSheetPlayer[] }[],
): StandoutPlayer | null {
  const candidates: StandoutPlayer[] = [];
  for (const side of sides) {
    for (const entry of side.rated) {
      if (entry.rating) candidates.push({ player: entry.player, rating: entry.rating, teamId: side.teamId });
    }
  }
  if (candidates.length === 0) return null;

  const best = candidates.reduce((top, next) => (next.rating.kivoRating > top.rating.kivoRating ? next : top));
  const tied = candidates.filter((c) => c.rating.kivoRating === best.rating.kivoRating);
  return tied.length === 1 ? best : null;
}

/** Rated players only, best first — the Ratings tab's ordering. Unrated
 * players are dropped rather than sorted to the bottom with a placeholder,
 * because "no rating" is not a low rating. */
export function rankRatedPlayers(rated: RatedTeamSheetPlayer[]): RatedTeamSheetPlayer[] {
  return rated
    .filter((entry) => entry.rating !== null)
    .sort((a, b) => b.rating!.kivoRating - a.rating!.kivoRating);
}
