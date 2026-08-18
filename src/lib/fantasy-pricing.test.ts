import { describe, expect, it } from "vitest";
import { emptyPlayerMatchFacts, APPEARANCE_POINTS, GOAL_POINTS_BY_POSITION } from "./fantasy-scoring";
import {
  MAX_PRICE,
  MAX_PRICE_NUDGE_PER_GAMEWEEK,
  MIN_PRICE,
  PRICE_NUDGE_PER_POINT,
  applyPriceNudge,
  computeGameweekPricingPoints,
  computePriceNudges,
} from "./fantasy-pricing";

describe("computeGameweekPricingPoints", () => {
  it("awards nothing for a player with no real starts and no events", () => {
    expect(computeGameweekPricingPoints(emptyPlayerMatchFacts(), 0, "Forward")).toBe(0);
  });

  it("awards appearance points per real start, not per fantasy pick", () => {
    expect(computeGameweekPricingPoints(emptyPlayerMatchFacts(), 2, "Forward")).toBe(APPEARANCE_POINTS * 2);
  });

  it("weights goals by position group, same as scoreRosterSlot", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 1 };
    expect(computeGameweekPricingPoints(facts, 1, "Goalkeeper")).toBe(APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Goalkeepers);
    expect(computeGameweekPricingPoints(facts, 1, "Striker")).toBe(APPEARANCE_POINTS + GOAL_POINTS_BY_POSITION.Forwards);
  });

  it("only credits clean sheets for goalkeepers and defenders", () => {
    const facts = { ...emptyPlayerMatchFacts(), cleanSheets: 1 };
    expect(computeGameweekPricingPoints(facts, 1, "Forward")).toBe(APPEARANCE_POINTS);
    expect(computeGameweekPricingPoints(facts, 1, "Defender")).toBeGreaterThan(APPEARANCE_POINTS);
  });

  it("never doubles for anything resembling a captain — no such concept here", () => {
    const facts = { ...emptyPlayerMatchFacts(), goals: 2 };
    const points = computeGameweekPricingPoints(facts, 1, "Midfielder");
    expect(points).toBe(APPEARANCE_POINTS + 2 * GOAL_POINTS_BY_POSITION.Midfielders);
  });
});

describe("computePriceNudges", () => {
  it("nudges a player scoring above their position-group average upward", () => {
    const nudges = computePriceNudges([
      { playerId: "a", position: "Forward", points: 10 },
      { playerId: "b", position: "Forward", points: 2 },
    ]);
    const a = nudges.find((n) => n.playerId === "a")!;
    const b = nudges.find((n) => n.playerId === "b")!;
    expect(a.delta).toBeGreaterThan(0);
    expect(b.delta).toBeLessThan(0);
    // Symmetric around the average of 6: both 4 points away from it.
    expect(a.delta).toBeCloseTo(-b.delta, 10);
  });

  it("never nudges a lone player in a position group — no real peer to compare against", () => {
    const nudges = computePriceNudges([{ playerId: "a", position: "Goalkeeper", points: 999 }]);
    expect(nudges).toEqual([{ playerId: "a", delta: 0 }]);
  });

  it("compares each position group only to its own peers, not across groups", () => {
    const nudges = computePriceNudges([
      { playerId: "gk", position: "Goalkeeper", points: 8 },
      { playerId: "fwd1", position: "Forward", points: 8 },
      { playerId: "fwd2", position: "Forward", points: 8 },
    ]);
    // Goalkeeper is alone in its group (no forwards mixed in), so it still
    // nudges to exactly 0 despite forwards scoring identically alongside it.
    expect(nudges.find((n) => n.playerId === "gk")!.delta).toBe(0);
  });

  it("caps the nudge at MAX_PRICE_NUDGE_PER_GAMEWEEK regardless of how extreme the outlier is", () => {
    const nudges = computePriceNudges([
      { playerId: "star", position: "Forward", points: 500 },
      { playerId: "average", position: "Forward", points: 2 },
    ]);
    const star = nudges.find((n) => n.playerId === "star")!;
    expect(star.delta).toBe(MAX_PRICE_NUDGE_PER_GAMEWEEK);
  });

  it("scales linearly with PRICE_NUDGE_PER_POINT below the cap", () => {
    const nudges = computePriceNudges([
      { playerId: "a", position: "Forward", points: 10 },
      { playerId: "b", position: "Forward", points: 8 },
    ]);
    // Average is 9; "a" is 1 point above it.
    expect(nudges.find((n) => n.playerId === "a")!.delta).toBeCloseTo(PRICE_NUDGE_PER_POINT, 10);
  });
});

describe("applyPriceNudge", () => {
  it("adds the delta to the current price", () => {
    expect(applyPriceNudge(5.0, 0.2)).toBe(5.2);
  });

  it("clamps at MIN_PRICE", () => {
    expect(applyPriceNudge(MIN_PRICE + 0.05, -1)).toBe(MIN_PRICE);
  });

  it("clamps at MAX_PRICE", () => {
    expect(applyPriceNudge(MAX_PRICE - 0.05, 1)).toBe(MAX_PRICE);
  });

  it("rounds to one decimal place", () => {
    expect(applyPriceNudge(5.03, 0.061)).toBe(5.1);
  });
});
