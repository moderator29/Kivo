import { describe, expect, it } from "vitest";
import {
  comparePlayerLines,
  headlinePlayerMetrics,
  orderPlayerLines,
  type PlayerMatchLine,
} from "./player-match-stats";

/** Shape-realistic, and deliberately patchy in the way a real per-player
 * payload is: a keeper with saves and no dribbles, a forward with shots and no
 * tackles reported, columns nobody filled in at all. */
function line(overrides: Partial<PlayerMatchLine> & Pick<PlayerMatchLine, "playerId" | "playerName">): PlayerMatchLine {
  return {
    teamId: "team-a",
    position: null,
    isSubstitute: false,
    minutesPlayed: null,
    goals: null,
    assists: null,
    shotsTotal: null,
    shotsOnTarget: null,
    passesTotal: null,
    passesKey: null,
    passAccuracy: null,
    tacklesTotal: null,
    interceptions: null,
    blocks: null,
    duelsTotal: null,
    duelsWon: null,
    dribblesAttempted: null,
    dribblesSucceeded: null,
    foulsDrawn: null,
    foulsCommitted: null,
    saves: null,
    goalsConceded: null,
    offsides: null,
    ...overrides,
  };
}

describe("comparePlayerLines", () => {
  it("drops a metric neither player reported", () => {
    const rows = comparePlayerLines(
      line({ playerId: "1", playerName: "A. Striker", goals: 1 }),
      line({ playerId: "2", playerName: "B. Keeper", saves: 4 }),
    );
    expect(rows.map((row) => row.label)).toEqual(["Goals", "Saves"]);
  });

  it("keeps a metric only one side reported, and refuses to compare it", () => {
    const [row] = comparePlayerLines(
      line({ playerId: "1", playerName: "A", shotsTotal: 3 }),
      line({ playerId: "2", playerName: "B" }),
    );
    expect(row.label).toBe("Shots");
    expect(row.left).toEqual({ reported: true, text: "3", weight: 3 });
    expect(row.right.reported).toBe(false);
    expect(row.comparable).toBe(false);
  });

  it("never reads an unreported value as nought", () => {
    const [row] = comparePlayerLines(
      line({ playerId: "1", playerName: "A", tacklesTotal: 0 }),
      line({ playerId: "2", playerName: "B" }),
    );
    // One player made no tackles; nobody counted the other's. Both would print
    // as "0" if null were coerced, which is the exact fabrication this bans.
    expect(row.left).toEqual({ reported: true, text: "0", weight: 0 });
    expect(row.right.reported).toBe(false);
  });

  it("renders a ratio as a ratio, and as a bare count when the denominator is missing", () => {
    const rows = comparePlayerLines(
      line({ playerId: "1", playerName: "A", duelsWon: 7, duelsTotal: 12 }),
      line({ playerId: "2", playerName: "B", duelsWon: 4 }),
    );
    const duels = rows.find((row) => row.label === "Duels won");
    expect(duels?.left).toEqual({ reported: true, text: "7/12", weight: 7 });
    expect(duels?.right).toEqual({ reported: true, text: "4", weight: 4 });
  });

  it("carries a suffix onto the number a fan reads", () => {
    const rows = comparePlayerLines(
      line({ playerId: "1", playerName: "A", minutesPlayed: 90, passAccuracy: 87 }),
      null,
    );
    expect(rows.map((row) => (row.left.reported ? row.left.text : null))).toEqual(["90'", "87%"]);
  });

  it("holds the metric order however sparse the two lines are", () => {
    const rows = comparePlayerLines(
      line({ playerId: "1", playerName: "A", goals: 1, minutesPlayed: 90, saves: 0 }),
      line({ playerId: "2", playerName: "B", assists: 2 }),
    );
    expect(rows.map((row) => row.label)).toEqual(["Minutes", "Goals", "Assists", "Saves"]);
  });
});

describe("orderPlayerLines", () => {
  it("leads with the most minutes and sinks the unclocked below everyone", () => {
    const ordered = orderPlayerLines([
      line({ playerId: "3", playerName: "C", minutesPlayed: null }),
      line({ playerId: "1", playerName: "A", minutesPlayed: 90 }),
      line({ playerId: "2", playerName: "B", minutesPlayed: 12 }),
    ]);
    expect(ordered.map((entry) => entry.playerName)).toEqual(["A", "B", "C"]);
  });

  it("breaks a tie by name so the list does not reshuffle between renders", () => {
    const ordered = orderPlayerLines([
      line({ playerId: "2", playerName: "Zidane", minutesPlayed: 90 }),
      line({ playerId: "1", playerName: "Abbott", minutesPlayed: 90 }),
    ]);
    expect(ordered.map((entry) => entry.playerName)).toEqual(["Abbott", "Zidane"]);
  });
});

describe("headlinePlayerMetrics", () => {
  it("leads a row with what actually happened, not with two noughts", () => {
    const cells = headlinePlayerMetrics(
      line({ playerId: "1", playerName: "A", goals: 0, assists: 1, shotsTotal: 4, minutesPlayed: 90 }),
    );
    expect(cells).toEqual([
      { label: "assist", text: "1" },
      { label: "shots", text: "4" },
    ]);
  });

  it("says nothing for a player whose line is all zeroes and nulls", () => {
    expect(headlinePlayerMetrics(line({ playerId: "1", playerName: "A", goals: 0, minutesPlayed: 4 }))).toEqual([]);
  });
});
