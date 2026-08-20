import { describe, expect, it } from "vitest";
import {
  CORRECT_PREDICTION_POINTS,
  CORRECT_PREDICTION_XP,
  MIN_MOTM_VOTES,
  PREDICTION_TYPE_POINTS,
  computeStreaks,
  predictionXp,
  motmVoteFromOptions,
  resolvePrediction,
  type FixtureFacts,
  type PredictionPick,
} from "@/lib/predictions";

/**
 * The six prediction types, tested where it matters: the boundary between
 * "you were wrong" and "KIVO could not tell".
 *
 * That boundary is the whole point of the design. A resolver that guesses is
 * indistinguishable from a correct one on the happy path — every test below
 * that asserts `unresolvable` is asserting that KIVO declined to invent an
 * answer, and those are the ones worth having.
 */

const BASE_PICK: PredictionPick = {
  type: "winner",
  outcome: null,
  homeScore: null,
  awayScore: null,
  playerId: null,
  totalGoals: null,
  cards: null,
  corners: null,
};

function pick(overrides: Partial<PredictionPick>): PredictionPick {
  return { ...BASE_PICK, ...overrides };
}

function facts(overrides: Partial<FixtureFacts> = {}): FixtureFacts {
  return { homeScore: 2, awayScore: 1, events: null, statistics: null, motm: null, ...overrides };
}

describe("winner", () => {
  it("settles from the final score alone", () => {
    expect(resolvePrediction(pick({ type: "winner", outcome: "home_win" }), facts())).toMatchObject({
      resolution: "correct",
      points: PREDICTION_TYPE_POINTS.winner,
    });
    expect(resolvePrediction(pick({ type: "winner", outcome: "draw" }), facts())).toMatchObject({
      resolution: "incorrect",
      points: 0,
    });
  });
});

describe("correct score", () => {
  it("requires the exact scoreline, not merely the right winner", () => {
    expect(
      resolvePrediction(pick({ type: "correct_score", homeScore: 2, awayScore: 1 }), facts()),
    ).toMatchObject({ resolution: "correct" });
    expect(
      resolvePrediction(pick({ type: "correct_score", homeScore: 3, awayScore: 1 }), facts()),
    ).toMatchObject({ resolution: "incorrect" });
  });
});

describe("total goals", () => {
  it("bands the combined score", () => {
    expect(resolvePrediction(pick({ type: "total_goals", totalGoals: "goals_2_3" }), facts())).toMatchObject({
      resolution: "correct",
    });
    expect(
      resolvePrediction(pick({ type: "total_goals", totalGoals: "goals_4_plus" }), facts()),
    ).toMatchObject({ resolution: "incorrect" });
  });

  it("uses the boundaries the enum names", () => {
    const scoreless = facts({ homeScore: 0, awayScore: 1 });
    expect(resolvePrediction(pick({ type: "total_goals", totalGoals: "goals_0_1" }), scoreless)).toMatchObject({
      resolution: "correct",
    });
    const four = facts({ homeScore: 3, awayScore: 1 });
    expect(resolvePrediction(pick({ type: "total_goals", totalGoals: "goals_4_plus" }), four)).toMatchObject({
      resolution: "correct",
    });
  });
});

describe("first scorer", () => {
  const scorer = pick({ type: "first_scorer", playerId: "player-a" });

  it("is unresolvable when there is no goal timeline at all", () => {
    const verdict = resolvePrediction(scorer, facts({ events: null }));
    expect(verdict.resolution).toBe("unresolvable");
    expect(verdict.points).toBeNull();
    expect(verdict.reason).toMatch(/goal timeline/i);
    // The reason is shown to whoever made the prediction, so it may not name
    // KIVO's plumbing back at them.
    expect(verdict.reason?.toLowerCase()).not.toMatch(/sync|provider|feed|api/);
  });

  it("is unresolvable when the event feed disagrees with the scoreline", () => {
    // A 2-1 with a synced feed containing no goals is an incomplete feed, not
    // a goalless match. Calling the prediction wrong here would punish the
    // user for KIVO's gap.
    const verdict = resolvePrediction(
      scorer,
      facts({ events: [{ eventType: "yellow_card", minute: 12, addedTime: null, playerId: "player-z" }] }),
    );
    expect(verdict.resolution).toBe("unresolvable");
  });

  it("is a real miss in a genuinely goalless match", () => {
    const verdict = resolvePrediction(
      scorer,
      facts({
        homeScore: 0,
        awayScore: 0,
        events: [{ eventType: "substitution", minute: 60, addedTime: null, playerId: "player-z" }],
      }),
    );
    expect(verdict.resolution).toBe("incorrect");
    expect(verdict.points).toBe(0);
  });

  it("takes the earliest goal, counting added time", () => {
    const verdict = resolvePrediction(
      scorer,
      facts({
        homeScore: 2,
        awayScore: 1,
        events: [
          { eventType: "goal", minute: 45, addedTime: 3, playerId: "player-b" },
          { eventType: "goal", minute: 45, addedTime: 1, playerId: "player-a" },
        ],
      }),
    );
    expect(verdict.resolution).toBe("correct");
  });

  it("does not credit an own goal as a first scorer", () => {
    const verdict = resolvePrediction(
      pick({ type: "first_scorer", playerId: "player-b" }),
      facts({
        homeScore: 2,
        awayScore: 1,
        events: [
          { eventType: "own_goal", minute: 10, addedTime: null, playerId: "player-a" },
          { eventType: "goal", minute: 30, addedTime: null, playerId: "player-b" },
        ],
      }),
    );
    expect(verdict.resolution).toBe("correct");
  });

  it("is unresolvable when the first goal has no scorer attached", () => {
    const verdict = resolvePrediction(
      scorer,
      facts({ events: [{ eventType: "goal", minute: 10, addedTime: null, playerId: null }] }),
    );
    expect(verdict.resolution).toBe("unresolvable");
  });
});

describe("cards and corners", () => {
  const both = pick({ type: "cards_corners", cards: "cards_3_4", corners: "corners_9_12" });

  it("is unresolvable without a statistics feed", () => {
    expect(resolvePrediction(both, facts({ statistics: null })).resolution).toBe("unresolvable");
  });

  it("is unresolvable when the provider reported neither figure", () => {
    expect(
      resolvePrediction(both, facts({ statistics: { totalCards: null, totalCorners: 10 } })).resolution,
    ).toBe("unresolvable");
  });

  it("requires both bands", () => {
    expect(
      resolvePrediction(both, facts({ statistics: { totalCards: 4, totalCorners: 11 } })).resolution,
    ).toBe("correct");
    expect(
      resolvePrediction(both, facts({ statistics: { totalCards: 4, totalCorners: 2 } })).resolution,
    ).toBe("incorrect");
  });
});

describe("man of the match", () => {
  const motm = pick({ type: "motm", playerId: "player-a" });

  it("is unresolvable when the Room never held a vote", () => {
    const verdict = resolvePrediction(motm, facts({ motm: null }));
    expect(verdict.resolution).toBe("unresolvable");
    expect(verdict.reason).toMatch(/no man-of-the-match vote/i);
  });

  it("refuses to settle on too few votes", () => {
    const verdict = resolvePrediction(
      motm,
      facts({ motm: { playerId: "player-a", totalVotes: MIN_MOTM_VOTES - 1, tied: false } }),
    );
    expect(verdict.resolution).toBe("unresolvable");
    expect(verdict.points).toBeNull();
  });

  it("refuses to settle a tie", () => {
    expect(
      resolvePrediction(motm, facts({ motm: { playerId: "player-a", totalVotes: 10, tied: true } })).resolution,
    ).toBe("unresolvable");
  });

  it("settles against a clear winner with a real sample", () => {
    expect(
      resolvePrediction(motm, facts({ motm: { playerId: "player-a", totalVotes: 9, tied: false } })).resolution,
    ).toBe("correct");
    expect(
      resolvePrediction(motm, facts({ motm: { playerId: "player-b", totalVotes: 9, tied: false } })).resolution,
    ).toBe("incorrect");
  });
});

describe("motmVoteFromOptions", () => {
  it("reports a tie rather than picking the first of two equals", () => {
    const vote = motmVoteFromOptions([
      { player_id: "a", vote_count: 4 },
      { player_id: "b", vote_count: 4 },
    ]);
    expect(vote).toMatchObject({ totalVotes: 8, tied: true });
  });

  it("treats an all-zero poll as having no winner", () => {
    const vote = motmVoteFromOptions([
      { player_id: "a", vote_count: 0 },
      { player_id: "b", vote_count: 0 },
    ]);
    expect(vote).toMatchObject({ playerId: null, totalVotes: 0, tied: true });
  });

  it("returns null for a fixture with no MOTM poll at all", () => {
    expect(motmVoteFromOptions([])).toBeNull();
  });

  it("carries the winning option's real player through", () => {
    const vote = motmVoteFromOptions([
      { player_id: "a", vote_count: 2 },
      { player_id: "b", vote_count: 7 },
    ]);
    expect(vote).toMatchObject({ playerId: "b", totalVotes: 9, tied: false });
  });
});

describe("an unresolvable verdict never carries points", () => {
  it("holds for every type that can be unresolvable", () => {
    const unsettleable: PredictionPick[] = [
      pick({ type: "first_scorer", playerId: "p" }),
      pick({ type: "cards_corners", cards: "cards_0_2", corners: "corners_0_8" }),
      pick({ type: "motm", playerId: "p" }),
    ];
    for (const candidate of unsettleable) {
      const verdict = resolvePrediction(candidate, facts());
      expect(verdict.resolution).toBe("unresolvable");
      expect(verdict.points).toBeNull();
      expect(verdict.reason).toBeTruthy();
    }
  });
});

describe("computeStreaks", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();

  it("counts consecutive correct picks by kickoff, not by submission order", () => {
    // Deliberately supplied out of order: the function sorts by kickoff.
    const streaks = computeStreaks([
      { pointsAwarded: 3, kickoffAt: day(3) },
      { pointsAwarded: 3, kickoffAt: day(1) },
      { pointsAwarded: 3, kickoffAt: day(2) },
    ]);
    expect(streaks).toEqual({ current: 3, best: 3 });
  });

  it("resets the current run on a miss but remembers the best", () => {
    const streaks = computeStreaks([
      { pointsAwarded: 3, kickoffAt: day(1) },
      { pointsAwarded: 3, kickoffAt: day(2) },
      { pointsAwarded: 3, kickoffAt: day(3) },
      { pointsAwarded: 0, kickoffAt: day(4) },
      { pointsAwarded: 3, kickoffAt: day(5) },
    ]);
    expect(streaks).toEqual({ current: 1, best: 3 });
  });

  /**
   * The invariant this whole design turns on. An unresolvable prediction is
   * absent from the input — its points_awarded is null, which every caller
   * filters on — so the run must span it as though the fixture were never
   * predicted. If someone ever changes a caller's filter to
   * `resolution is not null`, an unresolvable row arrives carrying
   * pointsAwarded 0 and silently breaks real streaks. This test is the
   * tripwire for that.
   */
  it("spans a gap where KIVO could not settle a prediction", () => {
    const withGap = computeStreaks([
      { pointsAwarded: 3, kickoffAt: day(1) },
      // day(2) was unresolvable, so it is not here at all.
      { pointsAwarded: 3, kickoffAt: day(3) },
    ]);
    expect(withGap).toEqual({ current: 2, best: 2 });

    // What it would look like if an unresolvable row leaked in as a zero.
    const ifItLeaked = computeStreaks([
      { pointsAwarded: 3, kickoffAt: day(1) },
      { pointsAwarded: 0, kickoffAt: day(2) },
      { pointsAwarded: 3, kickoffAt: day(3) },
    ]);
    expect(ifItLeaked.current).toBe(1);
  });

  it("is zero for someone with nothing settled yet", () => {
    expect(computeStreaks([])).toEqual({ current: 0, best: 0 });
  });
});

describe("XP is proportional to difficulty and unchanged for winners", () => {
  it("keeps the winner award byte-identical to what it always was", () => {
    expect(PREDICTION_TYPE_POINTS.winner).toBe(CORRECT_PREDICTION_POINTS);
    expect(predictionXp("winner")).toBe(CORRECT_PREDICTION_XP);
  });

  it("never awards XP for a type it could not settle", () => {
    // resolvePrediction is the only thing that decides points, and it returns
    // null for unresolvable — so there is no path from "unresolvable" to XP.
    const verdict = resolvePrediction(pick({ type: "motm", playerId: "p" }), facts({ motm: null }));
    expect(verdict.points).toBeNull();
  });
});
