/**
 * Pure fantasy-points scoring rules, kept framework/DB-client-free (like
 * fantasy-rules.ts's validateRoster) so both the admin scoring action
 * (src/app/admin/data-health/fantasy-actions.ts) and the UI's published
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

/** Pure scoring formula for a single fantasy_rosters slot. */
export function scoreRosterSlot(facts: PlayerMatchFacts, position: string | null, flags: RosterSlotFlags): number {
  if (!flags.isStarting) return 0;

  const group = positionGroup(position);
  const goalPoints = group === "Other" ? FLAT_GOAL_POINTS : GOAL_POINTS_BY_POSITION[group];

  let total = APPEARANCE_POINTS;
  total += facts.goals * goalPoints;
  total += facts.assists * ASSIST_POINTS;
  total += facts.ownGoals * OWN_GOAL_POINTS;
  total += facts.yellowCards * YELLOW_CARD_POINTS;
  total += facts.redCards * RED_CARD_POINTS;
  if (group !== "Other" && CLEAN_SHEET_ELIGIBLE.has(group)) {
    total += facts.cleanSheets * CLEAN_SHEET_POINTS;
  }

  if (flags.isCaptain || flags.doubleAsVice) total *= 2;
  return total;
}

/** Ordered, human-readable summary of the rules above — the single source
 * the "How scoring works" UI renders from, so the published explanation can
 * never drift from what scoreFantasyGameweek actually computes. */
export const SCORING_RULES_SUMMARY: string[] = [
  `Starting XI: +${APPEARANCE_POINTS} pts. Bench players score 0.`,
  `Goal: GK/DEF +${GOAL_POINTS_BY_POSITION.Goalkeepers}, MID +${GOAL_POINTS_BY_POSITION.Midfielders}, FWD +${GOAL_POINTS_BY_POSITION.Forwards}.`,
  `Assist: +${ASSIST_POINTS} pts.`,
  `Clean sheet (GK/DEF, team concedes 0): +${CLEAN_SHEET_POINTS} pts.`,
  `Yellow card: ${YELLOW_CARD_POINTS} pts. Red card or second yellow: ${RED_CARD_POINTS} pts.`,
  `Own goal: ${OWN_GOAL_POINTS} pts.`,
  "Captain: points doubled. Vice-captain doubles instead only if the captain wasn't in the starting XI.",
];
