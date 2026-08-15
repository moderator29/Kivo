import { positionGroup, type PositionGroupOrOther } from "@/app/(app)/fantasy/fantasy-rules";

/**
 * KIVO Rating Engine — computes a match rating for a player from real,
 * already-synced inputs only. See `docs/RATING_ENGINE.md` for the full
 * methodology and its documented limitations.
 *
 * The load-bearing distinction this module exists to enforce: `providerRating`
 * vs `kivoRating` on every returned value. API-Football's free tier supplies
 * no player ratings at all (confirmed in BUILD_STATUS.md), so `providerRating`
 * is typed here and always set to `null` — it is never populated with
 * anything, least of all `kivoRating`'s own value under a misleading name.
 * When a real ratings provider is ever connected, only the code that builds
 * `PlayerMatchRatingInput` needs to change to pass a real value through;
 * this module's contract already has a place for it.
 *
 * Every rating is stamped with `RATING_MODEL_VERSION` so a future change to
 * `RATING_WEIGHTS` (or to which inputs are used at all) is traceable on
 * historical values instead of silently reinterpreting them.
 */

export const RATING_MODEL_VERSION = "1.0";

/** 0-10 scale, matching the conventional football "match rating" genre. The
 * base/min/max values below are KIVO's own model constants, not fabricated
 * observations — they say nothing about how a specific player performed
 * until real per-match inputs (goals, cards, team score, etc.) move a
 * player's rating away from the neutral base. */
const BASE_RATING = 6.0;
const MIN_RATING = 1.0;
const MAX_RATING = 10.0;

type PerPositionWeights = {
  goal: number;
  assist: number;
  ownGoal: number;
  yellowCard: number;
  redCard: number;
};

/**
 * Single named, documented weights object — every number the model uses
 * lives here, nowhere else. Goal/assist weights are heavier for defensive
 * positions than attacking ones, the same convention already established by
 * `fantasy-scoring.ts`'s `GOAL_POINTS_BY_POSITION` (a goal from a
 * goalkeeper or defender is rarer and more valuable to a match rating than
 * one from a forward, for whom it's the expected job). Clean-sheet and
 * goals-conceded terms only apply to goalkeepers and defenders, the two
 * groups a team's defensive record is actually attributable to.
 */
export const RATING_WEIGHTS = {
  base: BASE_RATING,
  min: MIN_RATING,
  max: MAX_RATING,
  positions: {
    Goalkeepers: { goal: 3.5, assist: 2.0, ownGoal: -1.5, yellowCard: -0.3, redCard: -1.8 } satisfies PerPositionWeights,
    Defenders: { goal: 1.3, assist: 0.9, ownGoal: -1.3, yellowCard: -0.3, redCard: -1.6 } satisfies PerPositionWeights,
    Midfielders: { goal: 1.0, assist: 0.8, ownGoal: -1.1, yellowCard: -0.3, redCard: -1.5 } satisfies PerPositionWeights,
    Forwards: { goal: 0.8, assist: 0.7, ownGoal: -1.0, yellowCard: -0.3, redCard: -1.5 } satisfies PerPositionWeights,
    /** A player whose free-text `position` doesn't resolve to one of the
     * four known groups (`positionGroup()` returns "Other") — same "flat,
     * unweighted" fallback convention as `fantasy-scoring.ts`'s
     * `FLAT_GOAL_POINTS`, since there's no reliable basis to weight by. */
    Other: { goal: 1.0, assist: 0.8, ownGoal: -1.2, yellowCard: -0.3, redCard: -1.5 } satisfies PerPositionWeights,
  } satisfies Record<PositionGroupOrOther, PerPositionWeights>,
  /** Clean sheet bonus and per-goal-conceded penalty — goalkeepers and
   * defenders only (see doc comment above). There is no per-player saves,
   * tackles, or minutes-played column anywhere in the schema (checked
   * against `lineups`/`fixture_events`/`fixture_statistics` — the latter is
   * team-level only), so this is the only real defensive signal the engine
   * has: the team's actual final score while this player was involved. */
  cleanSheetBonus: {
    Goalkeepers: 1.5,
    Defenders: 0.6,
  },
  goalsConcededPenaltyPerGoal: {
    Goalkeepers: -0.3,
    Defenders: -0.1,
  },
} as const;

export type PlayerMatchRatingInput = {
  playerId: string;
  fixtureId: string;
  /** Only "finished" fixtures are rated — a live or scheduled match has
   * incomplete real inputs (the final score isn't known yet), so rating it
   * would mean guessing, not computing. */
  fixtureStatus: string;
  /** Free text, mirrors `players.position` — classified via the same
   * `positionGroup()` every other position-aware feature in KIVO shares
   * (fantasy scoring, squad grouping), not a second taxonomy. */
  position: string | null;
  /** From this player's `lineups` row for this fixture. */
  isStarting: boolean;
  /** Real counts from `fixture_events`, already scoped to this player and
   * this fixture by the caller (same pattern as `computePlayerMatchStats`
   * in `player-stats.ts`). */
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  /** Includes second-yellow dismissals, same convention as `player-stats.ts`
   * and `fantasy-scoring.ts`. */
  redCards: number;
  /** This player's team's actual final score in this fixture — from
   * `fixtures.home_score`/`away_score` once the fixture is finished, resolved
   * to "for"/"against" by the caller (same as `resolveFixtureResult` in
   * `form-engine.ts`). Null when not yet known. */
  teamGoalsFor: number | null;
  teamGoalsAgainst: number | null;
};

export type PlayerMatchRating = {
  playerId: string;
  fixtureId: string;
  modelVersion: string;
  positionGroup: PositionGroupOrOther;
  /** KIVO's own computed rating. Never presented as an official number. */
  kivoRating: number;
  /** Always null today — see this module's doc comment. Typed (not
   * omitted) so a future real provider integration has a field to fill in
   * without changing this type's shape or any consumer's rendering logic. */
  providerRating: null;
};

/**
 * True when there is at least one real signal this player was actually
 * involved in this match. API-Football's lineups response includes every
 * named substitute whether or not they came on (see
 * `providers/api-football.ts`'s `getLineups`), and the schema has no
 * minutes-played column — so `isStarting` false with zero recorded events is
 * indistinguishable from "an unused substitute who never played a minute".
 * Rather than guess, that case returns null from `computePlayerMatchRating`.
 */
function hasEvidenceOfInvolvement(input: PlayerMatchRatingInput): boolean {
  return input.isStarting || input.goals > 0 || input.assists > 0 || input.ownGoals > 0 || input.yellowCards > 0 || input.redCards > 0;
}

function clamp(value: number): number {
  return Math.min(RATING_WEIGHTS.max, Math.max(RATING_WEIGHTS.min, value));
}

/**
 * Computes one player's rating for one finished match, or returns `null`
 * when the real inputs are insufficient to compute one honestly:
 *  - the fixture isn't finished yet (final score unknown),
 *  - the team's final score is missing for some other reason, or
 *  - there is no real evidence this player was actually involved (see
 *    `hasEvidenceOfInvolvement`) — an unused substitute has 0 known
 *    minutes, not a fabricated baseline rating.
 */
export function computePlayerMatchRating(input: PlayerMatchRatingInput): PlayerMatchRating | null {
  if (input.fixtureStatus !== "finished") return null;
  if (input.teamGoalsFor === null || input.teamGoalsAgainst === null) return null;
  if (!hasEvidenceOfInvolvement(input)) return null;

  const group = positionGroup(input.position);
  const weights = RATING_WEIGHTS.positions[group];

  let rating = RATING_WEIGHTS.base;
  rating += input.goals * weights.goal;
  rating += input.assists * weights.assist;
  rating += input.ownGoals * weights.ownGoal;
  rating += input.yellowCards * weights.yellowCard;
  rating += input.redCards * weights.redCard;

  if (group === "Goalkeepers" || group === "Defenders") {
    if (input.teamGoalsAgainst === 0) {
      rating += RATING_WEIGHTS.cleanSheetBonus[group];
    } else {
      rating += input.teamGoalsAgainst * RATING_WEIGHTS.goalsConcededPenaltyPerGoal[group];
    }
  }

  return {
    playerId: input.playerId,
    fixtureId: input.fixtureId,
    modelVersion: RATING_MODEL_VERSION,
    positionGroup: group,
    kivoRating: Math.round(clamp(rating) * 10) / 10,
    providerRating: null,
  };
}

/** Below this many real rated matches, a season-average rating is more noise
 * than signal — same honesty rule as `form-engine.ts`'s `MIN_FORM_SAMPLE`,
 * kept as a separate constant since a single-match rating and a season
 * average are different enough claims to warrant different thresholds. */
export const MIN_RATING_SAMPLE = 3;

export type SeasonRatingSummary = {
  average: number;
  sampleSize: number;
  isSufficientSample: boolean;
  minSampleRequired: number;
  modelVersion: string;
};

/**
 * Aggregates a set of a single player's already-computed match ratings
 * (e.g. every non-null `computePlayerMatchRating` result for their season)
 * into one average. Returns `null` only when there are zero rated matches —
 * for 1 or 2, it still returns a value but flags `isSufficientSample: false`
 * so a UI can show the number with an honest caveat instead of hiding it
 * entirely; callers that want to hide small samples outright can check the
 * flag themselves.
 */
export function aggregateSeasonRating(ratings: PlayerMatchRating[]): SeasonRatingSummary | null {
  if (ratings.length === 0) return null;
  // Guard against mixing rating values computed under different model
  // versions — this should never happen in practice (callers fetch ratings
  // computed by the currently-deployed engine), but silently averaging
  // across a model change would misrepresent both numbers it blends.
  const modelVersion = ratings[0].modelVersion;
  const consistent = ratings.every((r) => r.modelVersion === modelVersion);
  const usable = consistent ? ratings : ratings.filter((r) => r.modelVersion === modelVersion);

  const sum = usable.reduce((total, r) => total + r.kivoRating, 0);
  return {
    average: Math.round((sum / usable.length) * 100) / 100,
    sampleSize: usable.length,
    isSufficientSample: usable.length >= MIN_RATING_SAMPLE,
    minSampleRequired: MIN_RATING_SAMPLE,
    modelVersion,
  };
}
