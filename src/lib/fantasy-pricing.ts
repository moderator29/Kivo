/**
 * Pure fantasy-pricing derivation, kept framework/DB-client-free (same
 * convention as fantasy-scoring.ts and rating-engine.ts) so both the real
 * write path (applyFantasyPriceNudges in
 * src/app/admin/data-health/fantasy-actions.ts, called at the end of
 * scoreFantasyGameweek) and any future "how pricing works" UI import the
 * exact same numbers.
 *
 * RECOMMENDATIONS.md item 251 ("251" in the section-16 sweep): every player
 * priced fantasy_player_prices.price used to be a permanent flat 5.0
 * (migration 0007's own comment: "no real performance history yet to derive
 * one from"). fantasy_points (team-level totals) and the FantasyScoringEngine
 * (fantasy-scoring.ts) are real now, so this module turns real match
 * involvement into a small, bounded, explainable price movement instead.
 *
 * Design, mirroring rating-engine.ts's "position-aware convention":
 *  - A player's real accumulated points for one gameweek are computed with
 *    the *exact* point values fantasy-scoring.ts's scoreRosterSlot uses
 *    (goal/assist/clean-sheet/card weights), but driven by real match
 *    involvement (lineups.is_starting — "did this player actually start a
 *    real match this gameweek") rather than any one fantasy manager's own
 *    pick (fantasy_rosters.is_starting) — pricing has to be honest for every
 *    real player, including the ones nobody happens to have rostered, so it
 *    can't be keyed off fantasy_rosters the way scoring itself is. No
 *    captain doubling either: captaincy is a fantasy-team selection, not a
 *    fact about the player's own real performance.
 *  - That gameweek score is compared only against the *same gameweek's*
 *    other real starters in the same position group (goalkeepers priced
 *    against goalkeepers, etc.) — over/under-performance relative to a
 *    peer average, not an absolute scale invented from nothing.
 *  - The resulting nudge is small and capped (PRICE_NUDGE_PER_POINT,
 *    MAX_PRICE_NUDGE_PER_GAMEWEEK) so a single big game can't send a price
 *    swinging to the edge of the range in one pass — real prices move
 *    gradually across a season, the same way this document's other
 *    "over/under-performance" ideas (item 249's captain suggestion, item
 *    250's differentials) treat a single sample as signal, not proof.
 *  - Every nudge is clamped back into fantasy_player_prices' own
 *    fantasy_player_prices_price_range check constraint (3.5-15.0) — this
 *    module's MIN_PRICE/MAX_PRICE must stay equal to that constraint.
 *
 * Still exactly what migration 0007's table comment insists on: KIVO's own
 * internal game-balancing currency, never presented as, or derived from, a
 * real transfer-market value.
 */
import {
  APPEARANCE_POINTS,
  ASSIST_POINTS,
  CLEAN_SHEET_POINTS,
  FLAT_GOAL_POINTS,
  GOAL_POINTS_BY_POSITION,
  OWN_GOAL_POINTS,
  RED_CARD_POINTS,
  YELLOW_CARD_POINTS,
  type PlayerMatchFacts,
} from "@/lib/fantasy-scoring";
import { positionGroup, type PositionGroup } from "@/app/(app)/fantasy/fantasy-rules";

export const PRICING_MODEL_VERSION = "1.0";

/** Must match fantasy_player_prices_price_range in migration 0007. */
export const MIN_PRICE = 3.5;
export const MAX_PRICE = 15.0;

/** Price movement per point a player finished above/below their position
 * group's average this gameweek — small on purpose (20 points above
 * average, an exceptional single gameweek, moves a price by 1.0). */
export const PRICE_NUDGE_PER_POINT = 0.05;

/** Absolute cap on one gameweek's price movement in either direction, applied
 * before the nudge is added to the current price — "small, capped,
 * transparent delta" per RECOMMENDATIONS item 251's own explicit rule. */
export const MAX_PRICE_NUDGE_PER_GAMEWEEK = 0.3;

const CLEAN_SHEET_ELIGIBLE: ReadonlySet<PositionGroup> = new Set(["Goalkeepers", "Defenders"]);

/**
 * One player's real accumulated fantasy-style points for a set of already-
 * aggregated match facts (goals/assists/own-goals/cards/clean-sheets — see
 * computePlayerMatchFacts in fantasy-scoring.ts) plus their real start
 * count, using the identical point values scoreRosterSlot scores a fantasy
 * pick with — minus captain doubling, which is a fantasy-team concept, not a
 * fact about the player's own real match performance.
 */
export function computeGameweekPricingPoints(
  facts: PlayerMatchFacts,
  realStarts: number,
  position: string | null,
): number {
  const group = positionGroup(position);
  const goalPoints = group === "Other" ? FLAT_GOAL_POINTS : GOAL_POINTS_BY_POSITION[group];

  let total = realStarts * APPEARANCE_POINTS;
  total += facts.goals * goalPoints;
  total += facts.assists * ASSIST_POINTS;
  total += facts.ownGoals * OWN_GOAL_POINTS;
  total += facts.yellowCards * YELLOW_CARD_POINTS;
  total += facts.redCards * RED_CARD_POINTS;
  if (group !== "Other" && CLEAN_SHEET_ELIGIBLE.has(group)) {
    total += facts.cleanSheets * CLEAN_SHEET_POINTS;
  }
  return total;
}

export type PlayerPricingInput = {
  playerId: string;
  position: string | null;
  /** This gameweek's real accumulated points — computeGameweekPricingPoints's
   * output, for a player with at least one real start this gameweek (the
   * caller filters to that; a player with no real involvement this gameweek
   * has nothing new to price them on, and is left out entirely rather than
   * scored as a real, comparable zero). */
  points: number;
};

export type PlayerPriceNudge = { playerId: string; delta: number };

/**
 * Computes this gameweek's bounded price nudge for every given player,
 * relative to their own position group's real average points this gameweek
 * (grouped among only the players passed in — the caller is responsible for
 * that set being "every player with a real start this gameweek", so the
 * average is a genuine peer comparison, not skewed by non-playing players
 * scored as zero). A group of one has nothing to compare against but itself,
 * so it always nudges to exactly 0 — correct, not a bug: no real peer signal
 * exists yet for that position group this gameweek.
 */
export function computePriceNudges(inputs: PlayerPricingInput[]): PlayerPriceNudge[] {
  const byGroup = new Map<string, PlayerPricingInput[]>();
  for (const input of inputs) {
    const group = positionGroup(input.position);
    const list = byGroup.get(group);
    if (list) list.push(input);
    else byGroup.set(group, [input]);
  }

  const nudges: PlayerPriceNudge[] = [];
  for (const group of byGroup.values()) {
    const average = group.reduce((sum, p) => sum + p.points, 0) / group.length;
    for (const p of group) {
      const raw = (p.points - average) * PRICE_NUDGE_PER_POINT;
      const delta = Math.max(-MAX_PRICE_NUDGE_PER_GAMEWEEK, Math.min(MAX_PRICE_NUDGE_PER_GAMEWEEK, raw));
      nudges.push({ playerId: p.playerId, delta });
    }
  }
  return nudges;
}

/** Applies one nudge to a current real price, clamped into
 * [MIN_PRICE, MAX_PRICE] and rounded to the column's numeric(4,1) precision. */
export function applyPriceNudge(currentPrice: number, delta: number): number {
  const next = currentPrice + delta;
  const clamped = Math.max(MIN_PRICE, Math.min(MAX_PRICE, next));
  return Math.round(clamped * 10) / 10;
}
