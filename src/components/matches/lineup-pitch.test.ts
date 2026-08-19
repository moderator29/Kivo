import { describe, expect, it } from "vitest";
import { pitchRowsFromPositions, type TeamSheetPlayer } from "@/lib/football/team-sheet";

/**
 * The position-letter fallback the lineup pitch draws from when a fixture's
 * team sheet carries no formation slots. Its whole job is refusing to draw:
 * every null below is a pitch KIVO does not put on screen because the data
 * behind it would have to be guessed at.
 *
 * (These cases moved here from the component when the row-building logic did —
 * see `src/lib/football/team-sheet.test.ts` for the formation-slot path that
 * now takes priority over this one.)
 */
function starter(overrides: Partial<TeamSheetPlayer>): TeamSheetPlayer {
  return {
    playerId: "p",
    playerName: "Player",
    shirtNumber: 1,
    position: "G",
    isStarting: true,
    goals: 0,
    ownGoals: 0,
    assists: 0,
    yellowCards: 0,
    redCards: 0,
    penaltiesMissed: 0,
    wentOff: null,
    cameOn: null,
    ...overrides,
  };
}

function fullXI(positions: string[]): TeamSheetPlayer[] {
  return positions.map((position, i) => starter({ playerId: `p${i}`, playerName: `Player ${i}`, position }));
}

describe("pitchRowsFromPositions", () => {
  it("buckets a real 4-3-3 into rows ordered forwards-to-goalkeeper", () => {
    const starters = fullXI(["G", "D", "D", "D", "D", "M", "M", "M", "F", "F", "F"]);
    const rows = pitchRowsFromPositions(starters);
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.key)).toEqual(["F", "M", "D", "G"]);
    expect(rows!.find((r) => r.key === "F")!.players).toHaveLength(3);
    expect(rows!.find((r) => r.key === "M")!.players).toHaveLength(3);
    expect(rows!.find((r) => r.key === "D")!.players).toHaveLength(4);
    expect(rows!.find((r) => r.key === "G")!.players).toHaveLength(1);
  });

  it("returns null when there aren't exactly 11 starters", () => {
    expect(pitchRowsFromPositions(fullXI(["G", "D", "D", "D", "D", "M", "M", "M", "F", "F"]))).toBeNull();
  });

  it("returns null when any starter has an unresolvable position", () => {
    const starters = fullXI(["G", "D", "D", "D", "D", "M", "M", "M", "F", "F", "SUB"]);
    expect(pitchRowsFromPositions(starters)).toBeNull();
  });

  it("returns null when there isn't exactly one goalkeeper", () => {
    const starters = fullXI(["D", "D", "D", "D", "D", "M", "M", "M", "F", "F", "F"]);
    expect(pitchRowsFromPositions(starters)).toBeNull();
  });
});
