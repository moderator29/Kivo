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
  computePlayerMatchFacts,
  emptyPlayerMatchFacts,
  scoreRosterSlot,
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
