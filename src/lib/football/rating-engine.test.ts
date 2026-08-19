import { describe, expect, it } from "vitest";
import {
  computePlayerMatchRating,
  aggregateSeasonRating,
  RATING_MODEL_VERSION,
  RATING_WEIGHTS,
  MIN_RATING_SAMPLE,
  type PlayerMatchRatingInput,
  type PlayerMatchRating,
} from "./rating-engine";

const baseInput = (overrides: Partial<PlayerMatchRatingInput> = {}): PlayerMatchRatingInput => ({
  playerId: "p1",
  fixtureId: "f1",
  fixtureStatus: "finished",
  position: "Forward",
  isStarting: true,
  goals: 0,
  assists: 0,
  ownGoals: 0,
  yellowCards: 0,
  redCards: 0,
  teamGoalsFor: 1,
  teamGoalsAgainst: 0,
  ...overrides,
});

describe("computePlayerMatchRating", () => {
  it("returns null when the fixture isn't finished — final score unknown", () => {
    expect(computePlayerMatchRating(baseInput({ fixtureStatus: "live" }))).toBeNull();
    expect(computePlayerMatchRating(baseInput({ fixtureStatus: "scheduled" }))).toBeNull();
  });

  it("returns null when the team's final score is missing", () => {
    expect(computePlayerMatchRating(baseInput({ teamGoalsFor: null }))).toBeNull();
    expect(computePlayerMatchRating(baseInput({ teamGoalsAgainst: null }))).toBeNull();
  });

  it("returns null for a player with no evidence of involvement (unused substitute, 0 known minutes)", () => {
    const rating = computePlayerMatchRating(
      baseInput({ isStarting: false, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0 }),
    );
    expect(rating).toBeNull();
  });

  it("still rates a non-starter who has real recorded events (came off the bench and did something)", () => {
    const rating = computePlayerMatchRating(baseInput({ isStarting: false, goals: 1 }));
    expect(rating).not.toBeNull();
  });

  it("rates a substitute KIVO holds a real substitution event for, even with nothing else recorded", () => {
    // A substitution event is a record that the player took the pitch — the
    // same class of evidence `isStarting` is. Without this the engine refused
    // to rate a player it could see had played half an hour.
    const rating = computePlayerMatchRating(
      baseInput({ isStarting: false, cameOnFromBench: true, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0 }),
    );
    expect(rating).not.toBeNull();
  });

  it("still refuses a named substitute with no substitution event and nothing recorded", () => {
    const rating = computePlayerMatchRating(
      baseInput({ isStarting: false, cameOnFromBench: false, goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0 }),
    );
    expect(rating).toBeNull();
  });

  it("returns a base rating around the neutral anchor for a clean appearance with nothing else recorded", () => {
    const rating = computePlayerMatchRating(baseInput());
    expect(rating).not.toBeNull();
    expect(rating!.kivoRating).toBeGreaterThan(RATING_WEIGHTS.min);
    expect(rating!.kivoRating).toBeLessThanOrEqual(RATING_WEIGHTS.max);
  });

  it("always sets providerRating to null and stamps the current model version", () => {
    const rating = computePlayerMatchRating(baseInput())!;
    expect(rating.providerRating).toBeNull();
    expect(rating.modelVersion).toBe(RATING_MODEL_VERSION);
  });

  it("weights a goalkeeper's goal more heavily than a forward's", () => {
    const gkRating = computePlayerMatchRating(baseInput({ position: "Goalkeeper", goals: 1 }))!;
    const fwdRating = computePlayerMatchRating(baseInput({ position: "Forward", goals: 1 }))!;
    expect(gkRating.kivoRating).toBeGreaterThan(fwdRating.kivoRating);
  });

  it("classifies position via the shared positionGroup() classifier", () => {
    const rating = computePlayerMatchRating(baseInput({ position: "Right-Back" }))!;
    expect(rating.positionGroup).toBe("Defenders");
  });

  it("gives a clean sheet bonus to goalkeepers and defenders only", () => {
    const gkClean = computePlayerMatchRating(baseInput({ position: "Goalkeeper", teamGoalsAgainst: 0 }))!;
    const gkConceded = computePlayerMatchRating(baseInput({ position: "Goalkeeper", teamGoalsAgainst: 2 }))!;
    expect(gkClean.kivoRating).toBeGreaterThan(gkConceded.kivoRating);

    const fwdClean = computePlayerMatchRating(baseInput({ position: "Forward", teamGoalsAgainst: 0 }))!;
    const fwdConceded = computePlayerMatchRating(baseInput({ position: "Forward", teamGoalsAgainst: 2 }))!;
    expect(fwdClean.kivoRating).toBe(fwdConceded.kivoRating);
  });

  it("penalises cards and own goals, never producing a rating below the floor", () => {
    const disaster = computePlayerMatchRating(
      baseInput({ redCards: 1, ownGoals: 2, yellowCards: 1, teamGoalsAgainst: 6 }),
    )!;
    expect(disaster.kivoRating).toBeGreaterThanOrEqual(RATING_WEIGHTS.min);
    expect(disaster.kivoRating).toBeLessThan(RATING_WEIGHTS.base);
  });

  it("never exceeds the rating ceiling for an exceptional match", () => {
    const hattrick = computePlayerMatchRating(baseInput({ goals: 5, assists: 3 }))!;
    expect(hattrick.kivoRating).toBeLessThanOrEqual(RATING_WEIGHTS.max);
  });
});

describe("aggregateSeasonRating", () => {
  const rating = (kivoRating: number, modelVersion = RATING_MODEL_VERSION): PlayerMatchRating => ({
    playerId: "p1",
    fixtureId: "f",
    modelVersion,
    positionGroup: "Forwards",
    kivoRating,
    providerRating: null,
  });

  it("returns null for zero ratings", () => {
    expect(aggregateSeasonRating([])).toBeNull();
  });

  it("flags an insufficient sample below MIN_RATING_SAMPLE without hiding the number", () => {
    const summary = aggregateSeasonRating([rating(7), rating(8)]);
    expect(summary).not.toBeNull();
    expect(summary!.sampleSize).toBe(2);
    expect(summary!.isSufficientSample).toBe(false);
    expect(MIN_RATING_SAMPLE).toBeGreaterThan(2);
  });

  it("averages a sufficient sample correctly", () => {
    const summary = aggregateSeasonRating([rating(6), rating(7), rating(8)])!;
    expect(summary.average).toBeCloseTo(7);
    expect(summary.isSufficientSample).toBe(true);
  });

  it("excludes ratings computed under a different model version rather than blending them", () => {
    const summary = aggregateSeasonRating([rating(6, "1.0"), rating(10, "0.9"), rating(8, "1.0")])!;
    expect(summary.modelVersion).toBe("1.0");
    expect(summary.sampleSize).toBe(2);
    expect(summary.average).toBeCloseTo(7);
  });
});
