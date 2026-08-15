import { describe, expect, it } from "vitest";
import {
  computeTeamForm,
  computePlayerForm,
  resolveFixtureResult,
  MIN_FORM_SAMPLE,
  type ResolvedResult,
} from "./form-engine";

const results = (pairs: [number, number][]): ResolvedResult[] =>
  pairs.map(([own, opp], i) => ({
    fixtureId: `f${i}`,
    kickoffAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    ownScore: own,
    oppScore: opp,
  }));

describe("computeTeamForm", () => {
  it("computes W/D/L sequence, goals and points for a sufficient sample", () => {
    const form = computeTeamForm(
      results([
        [2, 1], // W
        [0, 0], // D
        [1, 3], // L
        [4, 0], // W
        [2, 2], // D
      ]),
      "last5",
    );

    expect(form.sequence).toEqual(["W", "D", "L", "W", "D"]);
    expect(form.wins).toBe(2);
    expect(form.draws).toBe(2);
    expect(form.losses).toBe(1);
    expect(form.goalsScored).toBe(9);
    expect(form.goalsConceded).toBe(6);
    expect(form.goalDifference).toBe(3);
    expect(form.points).toBe(8);
    expect(form.pointsPerMatch).toBeCloseTo(1.6);
    expect(form.isSufficientSample).toBe(true);
    expect(form.sampleSize).toBe(5);
  });

  it("only takes the window's first N results even when more are passed", () => {
    const form = computeTeamForm(results([[1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [1, 0], [0, 1]]), "last5");
    expect(form.sampleSize).toBe(5);
    expect(form.wins).toBe(5);
  });

  it("uses every row passed for the season window", () => {
    const form = computeTeamForm(results([[1, 0], [0, 1], [2, 2]]), "season");
    expect(form.sampleSize).toBe(3);
  });

  it("reports insufficient sample and never fabricates a trend from 0 or 1 matches", () => {
    const zero = computeTeamForm([], "last5");
    expect(zero.isSufficientSample).toBe(false);
    expect(zero.sampleSize).toBe(0);
    expect(zero.sequence).toEqual([]);
    expect(zero.pointsPerMatch).toBeNull();

    const one = computeTeamForm(results([[1, 0]]), "last10");
    expect(one.sampleSize).toBe(1);
    expect(one.isSufficientSample).toBe(false);
    expect(MIN_FORM_SAMPLE).toBeGreaterThan(1);
  });
});

describe("computePlayerForm", () => {
  it("is the same aggregation as team form, applied to the player's team results", () => {
    const input = results([[3, 1], [1, 1]]);
    expect(computePlayerForm(input, "last5")).toEqual(computeTeamForm(input, "last5"));
  });
});

describe("resolveFixtureResult", () => {
  const base = {
    id: "fx1",
    kickoff_at: "2026-02-01T15:00:00Z",
    home_team_id: "team-home",
    away_team_id: "team-away",
  };

  it("resolves a finished fixture from the home team's perspective", () => {
    const result = resolveFixtureResult({ ...base, status: "finished", home_score: 2, away_score: 1 }, "team-home");
    expect(result).toEqual({ fixtureId: "fx1", kickoffAt: base.kickoff_at, ownScore: 2, oppScore: 1 });
  });

  it("resolves a finished fixture from the away team's perspective", () => {
    const result = resolveFixtureResult({ ...base, status: "finished", home_score: 2, away_score: 1 }, "team-away");
    expect(result).toEqual({ fixtureId: "fx1", kickoffAt: base.kickoff_at, ownScore: 1, oppScore: 2 });
  });

  it("returns null for a fixture not yet finished", () => {
    expect(resolveFixtureResult({ ...base, status: "scheduled", home_score: null, away_score: null }, "team-home")).toBeNull();
  });

  it("returns null for a team not involved in the fixture", () => {
    expect(resolveFixtureResult({ ...base, status: "finished", home_score: 1, away_score: 0 }, "some-other-team")).toBeNull();
  });

  it("returns null for a finished fixture missing a score rather than treating it as 0-0", () => {
    expect(resolveFixtureResult({ ...base, status: "finished", home_score: null, away_score: 0 }, "team-home")).toBeNull();
  });
});
