import { describe, expect, it } from "vitest";
import {
  APPEARANCE_POINTS,
  ASSIST_POINTS,
  CLEAN_SHEET_POINTS,
  FLAT_GOAL_POINTS,
  GOAL_POINTS_BY_POSITION,
  OWN_GOAL_POINTS,
  RED_CARD_POINTS,
  SCORING_MODEL_VERSION,
  YELLOW_CARD_POINTS,
  CURRENT_SCORING_RULES,
  computePlayerMatchFacts,
  emptyPlayerMatchFacts,
  parseScoringRules,
  scoreRosterSlot,
  scoreRosterSlotBreakdown,
  type FinishedFixtureFacts,
} from "./fantasy-scoring";

const STARTING = { isStarting: true, isCaptain: false, doubleAsVice: false } as const;
const BENCH = { isStarting: false, isCaptain: false, doubleAsVice: false } as const;

// RECOMMENDATIONS.md item 308: a scored gameweek's fantasy_points row is
// stamped with this constant (see admin/data-health/fantasy-actions.ts) so a
// future retuning of the point values above doesn't leave previously-scored
// gameweeks ambiguous about which ruleset produced them. This locks in that
// the marker exists and stays a real, non-empty string — the same guard
// rating-engine.test.ts already applies to RATING_MODEL_VERSION.
describe("SCORING_MODEL_VERSION", () => {
  it("is a non-empty version string", () => {
    expect(SCORING_MODEL_VERSION).toBeTruthy();
    expect(typeof SCORING_MODEL_VERSION).toBe("string");
  });
});

describe("scoreRosterSlot", () => {
  it("gives bench players zero points regardless of stats", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 3, assists: 2 };
    expect(scoreRosterSlot(facts, "Forward", BENCH)).toBe(0);
  });

  it("awards appearance points alone for a starter with no events", () => {
    expect(scoreRosterSlot(emptyPlayerMatchFacts(), "Forward", STARTING)).toBe(APPEARANCE_POINTS);
  });

  it("weights goals by position group", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 1 };
    expect(scoreRosterSlot(facts, "Goalkeeper", STARTING)).toBe(APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Goalkeepers);
    expect(scoreRosterSlot(facts, "Centre-Back", STARTING)).toBe(APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Defenders);
    expect(scoreRosterSlot(facts, "Midfielder", STARTING)).toBe(APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Midfielders);
    expect(scoreRosterSlot(facts, "Striker", STARTING)).toBe(APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Forwards);
  });

  it("falls back to a flat goal value when position doesn't resolve to a known group", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 1 };
    expect(scoreRosterSlot(facts, null, STARTING)).toBe(APPEARANCE_POINTS + FLAT_GOAL_POINTS);
    expect(scoreRosterSlot(facts, "Utility", STARTING)).toBe(APPEARANCE_POINTS + FLAT_GOAL_POINTS);
  });

  it("awards assist points", () => {
    const facts = { ...emptyPlayerMatchFacts(), assists: 2 };
    expect(scoreRosterSlot(facts, "Midfielder", STARTING)).toBe(APPEARANCE_POINTS + 2 * ASSIST_POINTS);
  });

  it("only awards clean sheet points to goalkeepers and defenders", () => {
    const facts = { ...emptyPlayerMatchFacts(), cleanSheets: 1 };
    expect(scoreRosterSlot(facts, "Goalkeeper", STARTING)).toBe(APPEARANCE_POINTS + CLEAN_SHEET_POINTS);
    expect(scoreRosterSlot(facts, "Full-Back", STARTING)).toBe(APPEARANCE_POINTS + CLEAN_SHEET_POINTS);
    expect(scoreRosterSlot(facts, "Midfielder", STARTING)).toBe(APPEARANCE_POINTS);
    expect(scoreRosterSlot(facts, "Striker", STARTING)).toBe(APPEARANCE_POINTS);
  });

  it("deducts for own goals and cards", () => {
    const facts = { ...emptyPlayerMatchFacts(), ownGoals: 1, yellowCards: 1, redCards: 1 };
    const expected = APPEARANCE_POINTS + OWN_GOAL_POINTS + YELLOW_CARD_POINTS + RED_CARD_POINTS;
    expect(scoreRosterSlot(facts, "Defender", STARTING)).toBe(expected);
  });

  it("doubles the total for the captain", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 1 };
    const base = APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Forwards;
    expect(scoreRosterSlot(facts, "Striker", { ...STARTING, isCaptain: true })).toBe(base * 2);
  });

  it("doubles the total for the vice-captain only when flagged (captain didn't start)", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 1 };
    const base = APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Forwards;
    expect(scoreRosterSlot(facts, "Striker", { ...STARTING, doubleAsVice: true })).toBe(base * 2);
    expect(scoreRosterSlot(facts, "Striker", { ...STARTING, doubleAsVice: false })).toBe(base);
  });
});

describe("computePlayerMatchFacts", () => {
  const fixture: FinishedFixtureFacts = {
    id: "fx1",
    homeTeamId: "home",
    awayTeamId: "away",
    homeScore: 2,
    awayScore: 0,
  };

  it("credits goals to the scorer and assists to the related player, for goal and penalty_goal events", () => {
    const facts = computePlayerMatchFacts(
      [
        { fixture_id: "fx1", player_id: "scorer", related_player_id: "assister", event_type: "goal" },
        { fixture_id: "fx1", player_id: "scorer", related_player_id: null, event_type: "penalty_goal" },
      ],
      [fixture],
      new Map(),
    );
    expect(facts.get("scorer")?.goals).toBe(2);
    expect(facts.get("assister")?.assists).toBe(1);
  });

  it("does not credit an own_goal as a goal, only a deduction to the player who committed it", () => {
    const facts = computePlayerMatchFacts(
      [{ fixture_id: "fx1", player_id: "unlucky", related_player_id: null, event_type: "own_goal" }],
      [fixture],
      new Map(),
    );
    expect(facts.get("unlucky")?.goals).toBe(0);
    expect(facts.get("unlucky")?.ownGoals).toBe(1);
  });

  it("counts a second yellow as a red card dismissal", () => {
    const facts = computePlayerMatchFacts(
      [
        { fixture_id: "fx1", player_id: "p1", related_player_id: null, event_type: "yellow_card" },
        { fixture_id: "fx1", player_id: "p2", related_player_id: null, event_type: "second_yellow_card" },
        { fixture_id: "fx1", player_id: "p3", related_player_id: null, event_type: "red_card" },
      ],
      [fixture],
      new Map(),
    );
    expect(facts.get("p1")?.yellowCards).toBe(1);
    expect(facts.get("p2")?.redCards).toBe(1);
    expect(facts.get("p3")?.redCards).toBe(1);
  });

  it("ignores substitution, var_review and penalty_missed events", () => {
    const facts = computePlayerMatchFacts(
      [
        { fixture_id: "fx1", player_id: "p1", related_player_id: "p2", event_type: "substitution" },
        { fixture_id: "fx1", player_id: "p3", related_player_id: null, event_type: "var_review" },
        { fixture_id: "fx1", player_id: "p4", related_player_id: null, event_type: "penalty_missed" },
      ],
      [fixture],
      new Map(),
    );
    expect(facts.size).toBe(0);
  });

  it("credits a clean sheet to a player whose team conceded zero in a finished fixture", () => {
    const facts = computePlayerMatchFacts(
      [],
      [fixture],
      new Map([
        ["home-player", "home"],
        ["away-player", "away"],
      ]),
    );
    expect(facts.get("home-player")?.cleanSheets).toBe(1);
    expect(facts.get("away-player")?.cleanSheets).toBe(0);
  });

  it("sums clean sheets across multiple finished fixtures (e.g. a double gameweek)", () => {
    const secondFixture: FinishedFixtureFacts = { id: "fx2", homeTeamId: "home", awayTeamId: "other", homeScore: 0, awayScore: 0 };
    const facts = computePlayerMatchFacts([], [fixture, secondFixture], new Map([["home-player", "home"]]));
    expect(facts.get("home-player")?.cleanSheets).toBe(2);
  });
});

/**
 * The ruleset layer (migration 0095). These tests exist because the failure
 * they catch is invisible: a score computed under one set of numbers and
 * stamped with the name of another is arithmetic nobody can reproduce, and it
 * surfaces as a manager arguing about a total rather than as a broken build.
 */
describe("versioned scoring rules", () => {
  /** The values seeded as version 1.0 by migration 0095, transcribed. If the
   * constants in fantasy-scoring.ts are changed without bumping
   * SCORING_MODEL_VERSION and seeding a new ruleset, this fails — which is the
   * whole point, because the alternative is last week's scores silently moving. */
  const SEEDED_V1 = {
    appearance: 2,
    assist: 3,
    cleanSheet: 4,
    yellowCard: -1,
    redCard: -3,
    ownGoal: -2,
    flatGoal: 5,
    captainMultiplier: 2,
    goalByPosition: { Goalkeepers: 6, Defenders: 6, Midfielders: 5, Forwards: 4 },
    cleanSheetEligible: ["Goalkeepers", "Defenders"],
  };

  it("the constants this release scores with are exactly the stored 1.0 ruleset", () => {
    expect(SCORING_MODEL_VERSION).toBe("1.0");
    expect(CURRENT_SCORING_RULES).toEqual(SEEDED_V1);
  });

  it("parses a well-formed stored ruleset", () => {
    expect(parseScoringRules(SEEDED_V1)).toEqual(SEEDED_V1);
  });

  it("refuses a partial ruleset rather than filling the gap from today's constants", () => {
    // The dangerous case: everything present except one rate. Defaulting it
    // would score a gameweek under a mixture of two rulesets and stamp it with
    // the name of one of them.
    const { assist: _dropped, ...missingOneRate } = SEEDED_V1;
    expect(parseScoringRules(missingOneRate)).toBeNull();

    const missingOnePosition = {
      ...SEEDED_V1,
      goalByPosition: { Goalkeepers: 6, Defenders: 6, Midfielders: 5 },
    };
    expect(parseScoringRules(missingOnePosition)).toBeNull();
  });

  it("refuses malformed shapes rather than coercing them", () => {
    expect(parseScoringRules(null)).toBeNull();
    expect(parseScoringRules("1.0")).toBeNull();
    expect(parseScoringRules({ ...SEEDED_V1, appearance: "2" })).toBeNull();
    expect(parseScoringRules({ ...SEEDED_V1, cleanSheetEligible: ["Sweepers"] })).toBeNull();
    expect(parseScoringRules({ ...SEEDED_V1, cleanSheetEligible: "Goalkeepers" })).toBeNull();
    expect(parseScoringRules({ ...SEEDED_V1, appearance: Number.NaN })).toBeNull();
  });

  it("actually scores with the ruleset it is given, not with the constants", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 2 };
    const doubled = parseScoringRules({
      ...SEEDED_V1,
      appearance: 4,
      goalByPosition: { Goalkeepers: 12, Defenders: 12, Midfielders: 10, Forwards: 8 },
    })!;

    const underCurrent = scoreRosterSlot(facts, "Forward", { isStarting: true, isCaptain: false, doubleAsVice: false });
    const underDoubled = scoreRosterSlot(
      facts,
      "Forward",
      { isStarting: true, isCaptain: false, doubleAsVice: false },
      doubled,
    );
    expect(underCurrent).toBe(2 + 2 * 4);
    expect(underDoubled).toBe(4 + 2 * 8);
  });
});

describe("scoreRosterSlotBreakdown — the audit trail", () => {
  const flags = { isStarting: true, isCaptain: false, doubleAsVice: false };

  it("itemises every component, and they add up to the subtotal", () => {
    const facts = {
      goals: 2,
      assists: 1,
      ownGoals: 1,
      yellowCards: 1,
      redCards: 0,
      cleanSheets: 1,
    };
    const slot = scoreRosterSlotBreakdown(facts, "Defender", flags);

    expect(slot.appearancePoints).toBe(2);
    expect(slot.goalPoints).toBe(12);
    expect(slot.assistPoints).toBe(3);
    expect(slot.ownGoalPoints).toBe(-2);
    expect(slot.cardPoints).toBe(-1);
    expect(slot.cleanSheetPoints).toBe(4);

    const summed =
      slot.appearancePoints +
      slot.goalPoints +
      slot.assistPoints +
      slot.ownGoalPoints +
      slot.cardPoints +
      slot.cleanSheetPoints;
    expect(summed).toBe(slot.subtotal);
    expect(slot.total).toBe(slot.subtotal * slot.multiplier);
  });

  it("keeps the captain's double as a separate visible step, not baked into every line", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 1 };
    const plain = scoreRosterSlotBreakdown(facts, "Midfielder", flags);
    const captain = scoreRosterSlotBreakdown(facts, "Midfielder", { ...flags, isCaptain: true });

    // Every component is identical; only the multiplier and the total differ.
    expect(captain.goalPoints).toBe(plain.goalPoints);
    expect(captain.subtotal).toBe(plain.subtotal);
    expect(captain.multiplier).toBe(2);
    expect(captain.total).toBe(plain.subtotal * 2);
  });

  it("records a bench player as a real itemised zero rather than an absence", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 3 };
    const slot = scoreRosterSlotBreakdown(facts, "Forward", { ...flags, isStarting: false });
    // "On your bench, scored 0" is an answer a manager asks for, and it is not
    // the same as "we have no record of this player".
    expect(slot.isStarting).toBe(false);
    expect(slot.total).toBe(0);
    expect(slot.goalPoints).toBe(0);
    expect(slot.multiplier).toBe(1);
  });

  it("gives a non-eligible position no clean-sheet points even when their team kept one", () => {
    const facts = { ...emptyPlayerMatchFacts(), cleanSheets: 1 };
    expect(scoreRosterSlotBreakdown(facts, "Forward", flags).cleanSheetPoints).toBe(0);
    expect(scoreRosterSlotBreakdown(facts, "Goalkeeper", flags).cleanSheetPoints).toBe(4);
  });

  it("agrees exactly with the number-only entry point", () => {
    const facts = { goals: 1, assists: 2, ownGoals: 0, yellowCards: 1, redCards: 1, cleanSheets: 0 };
    const asNumber = scoreRosterSlot(facts, "Midfielder", { ...flags, isCaptain: true });
    expect(scoreRosterSlotBreakdown(facts, "Midfielder", { ...flags, isCaptain: true }).total).toBe(asNumber);
  });
});
