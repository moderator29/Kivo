/**
 * Pure fantasy-points scoring rules, kept framework/DB-client-free (like
 * fantasy-rules.ts's validateRoster) so both the admin scoring action
 * (src/app/admin/football/fantasy-actions.ts) and the UI's published
 * "how scoring works" explanation import the exact same numbers — nothing
 * here can drift between what's computed and what's shown to users.
 *
 * Built only from what supabase/migrations/0001_kivo_core_schema.sql's
 * fixture_events actually tracks (event_type enum: goal, own_goal,
 * penalty_goal, penalty_missed, yellow_card, second_yellow_card, red_card,
 * substitution, var_review) and what fantasy_rosters actually tracks
 * (is_starting, is_captain, is_vice_captain). Nothing here is invented:
 *
 *  - Appearance: a player in the fantasy starting XI (fantasy_rosters.
 *    is_starting) earns APPEARANCE_POINTS. Bench players score zero,
 *    full stop — this schema has no substitute-comes-on-during-the-match
 *    concept for fantasy squads, so there's no partial-bench credit to give.
 *  - Goals: 'goal' and 'penalty_goal' events award the scoring player_id
 *    goal points, weighted by position group (players.position is real but
 *    free text — positionGroup() buckets it the same way the rest of the
 *    fantasy UI already does; a player whose position doesn't resolve to a
 *    known group gets the flat FLAT_GOAL_POINTS instead of a per-position
 *    weight, since there's nothing reliable to weight by).
 *  - Assists: a 'goal' or 'penalty_goal' event's related_player_id (per the
 *    migration's own comment: "assist provider") earns ASSIST_POINTS.
 *  - Own goals: a real, tracked event type — deducted from the player who
 *    committed it rather than silently ignored.
 *  - Clean sheet: goalkeepers and defenders only, awarded per finished
 *    fixture in the scored set where the player's team conceded zero.
 *  - Cards: yellow_card is a small deduction; red_card and
 *    second_yellow_card (a second booking is a dismissal too) share the
 *    harsher deduction.
 *  - penalty_missed, substitution, var_review: no scoring effect. A missed
 *    penalty could arguably be a deduction, but the task's own guidance is
 *    to keep this auditable rather than exhaustive, and the schema doesn't
 *    distinguish "missed by this player's normal run of play" from other
 *    context, so it's left neutral.
 *  - Captain: doubles that roster slot's total.
 *  - Vice-captain: doubles instead of the captain, but only as a stand-in —
 *    see the LIMITATION note below.
 *
 * LIMITATION (documented per this task's explicit instruction): "did the
 * captain actually play" is approximated by the captain's own
 * fantasy_rosters.is_starting flag for this gameweek, not by any real-match
 * appearance record. This schema has no play-time/substitution-on-the-pitch
 * data tied to a specific fantasy pick (lineups.is_starting reflects the
 * real match XI, not the fantasy squad, and isn't joined here) — so "the
 * captain didn't play" really means "the manager didn't start their captain
 * in their fantasy XI for this gameweek", a fantasy-selection fact, not a
 * confirmed real-world one. This is the simplification the task explicitly
 * allows in place of a fuller, less auditable rule.
 */
import { positionGroup, type PositionGroup } from "@/app/(app)/fantasy/fantasy-rules";
import type { Database } from "@/lib/supabase/types";

export type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];

/** RECOMMENDATIONS.md item 308: mirrors rating-engine.ts's RATING_MODEL_VERSION
 * pattern — stamped onto every fantasy_points row scoreFantasyGameweek writes
 * (fantasy_points.scoring_model_version, migration 0052) so a future tuning of
 * the point values below doesn't leave previously-scored gameweeks ambiguous
 * about which ruleset actually produced them. Bump this whenever any constant
 * or the scoring formula in this file changes in a way that would score the
 * same real match facts differently. */
export const SCORING_MODEL_VERSION = "1.0";

export const APPEARANCE_POINTS = 2;
export const ASSIST_POINTS = 3;
export const CLEAN_SHEET_POINTS = 4;
export const YELLOW_CARD_POINTS = -1;
export const RED_CARD_POINTS = -3;
export const OWN_GOAL_POINTS = -2;

/** Goal points by position group — defending positions score more for a
 * goal than attacking ones do, the standard fantasy-football convention. */
export const GOAL_POINTS_BY_POSITION: Record<PositionGroup, number> = {
  Goalkeepers: 6,
  Defenders: 6,
  Midfielders: 5,
  Forwards: 4,
};

/** Used when a player's free-text `position` doesn't resolve to one of the
 * four known groups (positionGroup() returns "Other") — no reliable basis
 * to weight by, so every unclassified goal scores the same flat amount. */
export const FLAT_GOAL_POINTS = 5;

/** Only these two groups can earn the clean sheet bonus. */
const CLEAN_SHEET_ELIGIBLE: ReadonlySet<PositionGroup> = new Set(["Goalkeepers", "Defenders"]);

/**
 * The rule VALUES, as data.
 *
 * ## Why this exists, when the constants above already do
 *
 * `SCORING_MODEL_VERSION` was stamped onto every scored row, which told you
 * WHICH ruleset produced a score and nothing about what that ruleset said. The
 * numbers lived only in this file, so:
 *
 *   * a past gameweek could not be re-explained — an itemised breakdown would
 *     be shown against today's rates and would not add up to the stored total;
 *   * re-running the scorer on an old gameweek silently rescored it under the
 *     new rules, which is exactly the "last week's scores must not move" the
 *     founding directive names.
 *
 * `fantasy_scoring_rulesets` (migration 0095) stores these values per version.
 * The FORMULA stays here — `scoreRosterSlotBreakdown` — and the numbers are
 * passed in. That split is deliberate in both directions: a fully data-driven
 * formula would be a small interpreter nobody can read or test, and fully
 * hardcoded numbers are the problem being fixed.
 */
export type ScoringRules = {
  appearance: number;
  assist: number;
  cleanSheet: number;
  yellowCard: number;
  redCard: number;
  ownGoal: number;
  flatGoal: number;
  captainMultiplier: number;
  goalByPosition: Record<PositionGroup, number>;
  cleanSheetEligible: PositionGroup[];
};

/** The values this release scores NEW gameweeks with. Built from the constants
 * above so there is one definition, and asserted against the stored `1.0`
 * ruleset by `fantasy-scoring.test.ts` — if they ever disagree, that test fails
 * rather than the disagreement being discovered in somebody's points. */
export const CURRENT_SCORING_RULES: ScoringRules = {
  appearance: APPEARANCE_POINTS,
  assist: ASSIST_POINTS,
  cleanSheet: CLEAN_SHEET_POINTS,
  yellowCard: YELLOW_CARD_POINTS,
  redCard: RED_CARD_POINTS,
  ownGoal: OWN_GOAL_POINTS,
  flatGoal: FLAT_GOAL_POINTS,
  captainMultiplier: 2,
  goalByPosition: GOAL_POINTS_BY_POSITION,
  cleanSheetEligible: [...CLEAN_SHEET_ELIGIBLE],
};

/**
 * Validates a ruleset read back out of the database.
 *
 * Returns null — never a partially-defaulted object — for anything it cannot
 * fully verify. A ruleset with one missing field, silently filled from today's
 * constants, would score a gameweek under a mixture of two rulesets and stamp
 * it with the name of one of them, which is worse than refusing: the caller can
 * handle "I could not read the ruleset" honestly, and cannot handle a number
 * that is quietly a hybrid.
 */
export function parseScoringRules(value: unknown): ScoringRules | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const num = (key: string): number | null => (typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : null);

  const appearance = num("appearance");
  const assist = num("assist");
  const cleanSheet = num("cleanSheet");
  const yellowCard = num("yellowCard");
  const redCard = num("redCard");
  const ownGoal = num("ownGoal");
  const flatGoal = num("flatGoal");
  const captainMultiplier = num("captainMultiplier");
  if (
    appearance === null || assist === null || cleanSheet === null || yellowCard === null ||
    redCard === null || ownGoal === null || flatGoal === null || captainMultiplier === null
  ) {
    return null;
  }

  const rawGoals = raw.goalByPosition;
  if (typeof rawGoals !== "object" || rawGoals === null) return null;
  const goalByPosition = {} as Record<PositionGroup, number>;
  for (const group of ["Goalkeepers", "Defenders", "Midfielders", "Forwards"] as PositionGroup[]) {
    const v = (rawGoals as Record<string, unknown>)[group];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    goalByPosition[group] = v;
  }

  const rawEligible = raw.cleanSheetEligible;
  if (!Array.isArray(rawEligible)) return null;
  const cleanSheetEligible: PositionGroup[] = [];
  for (const entry of rawEligible) {
    if (entry !== "Goalkeepers" && entry !== "Defenders" && entry !== "Midfielders" && entry !== "Forwards") {
      return null;
    }
    cleanSheetEligible.push(entry);
  }

  return {
    appearance, assist, cleanSheet, yellowCard, redCard, ownGoal, flatGoal,
    captainMultiplier, goalByPosition, cleanSheetEligible,
  };
}

export type PlayerMatchFacts = {
  goals: number;
  assists: number;
  ownGoals: number;
  yellowCards: number;
  redCards: number; // includes second-yellow dismissals
  cleanSheets: number; // count of finished fixtures in the set where the player's team conceded 0
};

export function emptyPlayerMatchFacts(): PlayerMatchFacts {
  return { goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0, cleanSheets: 0 };
}

export type FinishedFixtureFacts = {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
};

type RawFixtureEvent = {
  fixture_id: string;
  player_id: string | null;
  related_player_id: string | null;
  event_type: FixtureEventType;
};

/**
 * Aggregates raw fixture_events (already filtered to finished fixtures in
 * the gameweek's fixture set) plus each finished fixture's final score into
 * per-player real-match facts. `playerTeamId` maps a rostered player to the
 * team to credit clean sheets against — sourced from players.current_team_id
 * by the caller, the same "player's team" signal the rest of the fantasy UI
 * already relies on (see fantasy-builder's roster join).
 */
export function computePlayerMatchFacts(
  events: RawFixtureEvent[],
  finishedFixtures: FinishedFixtureFacts[],
  playerTeamId: Map<string, string>,
): Map<string, PlayerMatchFacts> {
  const facts = new Map<string, PlayerMatchFacts>();
  const get = (playerId: string): PlayerMatchFacts => {
    let f = facts.get(playerId);
    if (!f) {
      f = emptyPlayerMatchFacts();
      facts.set(playerId, f);
    }
    return f;
  };

  for (const event of events) {
    if (event.event_type === "goal" || event.event_type === "penalty_goal") {
      if (event.player_id) get(event.player_id).goals += 1;
      if (event.related_player_id) get(event.related_player_id).assists += 1;
    } else if (event.event_type === "own_goal") {
      if (event.player_id) get(event.player_id).ownGoals += 1;
    } else if (event.event_type === "yellow_card") {
      if (event.player_id) get(event.player_id).yellowCards += 1;
    } else if (event.event_type === "red_card" || event.event_type === "second_yellow_card") {
      if (event.player_id) get(event.player_id).redCards += 1;
    }
    // penalty_missed, substitution, var_review: no scoring effect (see module doc comment).
  }

  for (const [playerId, teamId] of playerTeamId) {
    // Ensure every rostered player gets a facts entry, even one with no
    // events and no clean sheet, so callers can rely on a present-but-zero
    // record instead of distinguishing "no facts computed" from "computed
    // as zero".
    const record = get(playerId);
    for (const fixture of finishedFixtures) {
      const isHome = fixture.homeTeamId === teamId;
      const isAway = fixture.awayTeamId === teamId;
      if (!isHome && !isAway) continue;
      const concededByThisTeam = isHome ? fixture.awayScore : fixture.homeScore;
      if (concededByThisTeam === 0) record.cleanSheets += 1;
    }
  }

  return facts;
}

export type RosterSlotFlags = {
  isStarting: boolean;
  isCaptain: boolean;
  /** True when this slot is the vice-captain AND the team's captain didn't
   * start (per the LIMITATION note above) — the caller resolves this before
   * calling in, since it depends on a sibling roster row, not this one. */
  doubleAsVice: boolean;
};

/**
 * One roster slot's score, itemised.
 *
 * Every component is returned alongside the counts that produced it, because a
 * total on its own is not auditable and neither half alone is checkable: counts
 * without points cannot be reconciled against the total, and points without
 * counts cannot be reconciled against the match. With both, a disputed score
 * resolves to either a wrong count (a sync problem) or a wrong rate (a rule
 * problem) — different bugs, different fixes.
 *
 * Components are PRE-multiplier and `total` is post, so the captain's double is
 * a visible step rather than baked into every line. A manager checking their
 * armband should be able to see the base and the doubling separately.
 */
export type SlotBreakdown = {
  isStarting: boolean;
  multiplier: number;
  appearancePoints: number;
  goalPoints: number;
  assistPoints: number;
  ownGoalPoints: number;
  cardPoints: number;
  cleanSheetPoints: number;
  /** Sum of the components, before the multiplier. */
  subtotal: number;
  /** `subtotal * multiplier` — what this slot contributed to the team. */
  total: number;
};

export function scoreRosterSlotBreakdown(
  facts: PlayerMatchFacts,
  position: string | null,
  flags: RosterSlotFlags,
  rules: ScoringRules = CURRENT_SCORING_RULES,
): SlotBreakdown {
  const empty: SlotBreakdown = {
    isStarting: flags.isStarting,
    multiplier: 1,
    appearancePoints: 0,
    goalPoints: 0,
    assistPoints: 0,
    ownGoalPoints: 0,
    cardPoints: 0,
    cleanSheetPoints: 0,
    subtotal: 0,
    total: 0,
  };
  // A bench player scores nothing, and the itemised zero is written anyway —
  // "this player was on your bench and scored 0" is a real answer a manager
  // asks for, and it is not the same as "we have no record of this player".
  if (!flags.isStarting) return empty;

  const group = positionGroup(position);
  const goalRate = group === "Other" ? rules.flatGoal : rules.goalByPosition[group];
  const cleanSheetEligible = group !== "Other" && rules.cleanSheetEligible.includes(group);

  const appearancePoints = rules.appearance;
  const goalPoints = facts.goals * goalRate;
  const assistPoints = facts.assists * rules.assist;
  const ownGoalPoints = facts.ownGoals * rules.ownGoal;
  const cardPoints = facts.yellowCards * rules.yellowCard + facts.redCards * rules.redCard;
  const cleanSheetPoints = cleanSheetEligible ? facts.cleanSheets * rules.cleanSheet : 0;

  const subtotal =
    appearancePoints + goalPoints + assistPoints + ownGoalPoints + cardPoints + cleanSheetPoints;
  const multiplier = flags.isCaptain || flags.doubleAsVice ? rules.captainMultiplier : 1;

  return {
    isStarting: true,
    multiplier,
    appearancePoints,
    goalPoints,
    assistPoints,
    ownGoalPoints,
    cardPoints,
    cleanSheetPoints,
    subtotal,
    total: subtotal * multiplier,
  };
}

/** The slot's total only. Kept as the narrow entry point for callers that
 * genuinely want a number (and for the tests that predate itemisation) — it is
 * the same computation, not a second one. */
export function scoreRosterSlot(
  facts: PlayerMatchFacts,
  position: string | null,
  flags: RosterSlotFlags,
  rules: ScoringRules = CURRENT_SCORING_RULES,
): number {
  return scoreRosterSlotBreakdown(facts, position, flags, rules).total;
}

/** Ordered, human-readable summary of the rules above — the single source
 * the "How scoring works" UI renders from, so the published explanation can
 * never drift from what scoreFantasyGameweek actually computes. */
export function buildScoringRulesSummary(rules: ScoringRules): string[] {
  return [
    `Starting XI: +${rules.appearance} pts. Bench players score 0.`,
    `Goal: GK/DEF +${rules.goalByPosition.Goalkeepers}, MID +${rules.goalByPosition.Midfielders}, FWD +${rules.goalByPosition.Forwards}.`,
    `Assist: +${rules.assist} pts.`,
    `Clean sheet (GK/DEF, team concedes 0): +${rules.cleanSheet} pts.`,
    `Yellow card: ${rules.yellowCard} pts. Red card or second yellow: ${rules.redCard} pts.`,
    `Own goal: ${rules.ownGoal} pts.`,
    "Captain: points doubled. Vice-captain doubles instead only if the captain wasn't in the starting XI.",
  ];
}

export const SCORING_RULES_SUMMARY: string[] = [
  `Starting XI: +${APPEARANCE_POINTS} pts. Bench players score 0.`,
  `Goal: GK/DEF +${GOAL_POINTS_BY_POSITION.Goalkeepers}, MID +${GOAL_POINTS_BY_POSITION.Midfielders}, FWD +${GOAL_POINTS_BY_POSITION.Forwards}.`,
  `Assist: +${ASSIST_POINTS} pts.`,
  `Clean sheet (GK/DEF, team concedes 0): +${CLEAN_SHEET_POINTS} pts.`,
  `Yellow card: ${YELLOW_CARD_POINTS} pts. Red card or second yellow: ${RED_CARD_POINTS} pts.`,
  `Own goal: ${OWN_GOAL_POINTS} pts.`,
  "Captain: points doubled. Vice-captain doubles instead only if the captain wasn't in the starting XI.",
];
