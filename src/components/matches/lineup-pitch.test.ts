import { describe, expect, it } from "vitest";
import { buildPitchRows, type PitchStarter } from "./lineup-pitch";

function starter(overrides: Partial<PitchStarter>): PitchStarter {
  return { playerId: "p", playerName: "Player", shirtNumber: 1, position: "G", ...overrides };
}

function fullXI(positions: string[]): PitchStarter[] {
  return positions.map((position, i) => starter({ playerId: `p${i}`, playerName: `Player ${i}`, position }));
}

describe("buildPitchRows", () => {
  it("buckets a real 4-3-3 into rows ordered forwards-to-goalkeeper", () => {
    const starters = fullXI(["G", "D", "D", "D", "D", "M", "M", "M", "F", "F", "F"]);
    const rows = buildPitchRows(starters);
    expect(rows).not.toBeNull();
    expect(rows!.map((r) => r.key)).toEqual(["F", "M", "D", "G"]);
    expect(rows!.find((r) => r.key === "F")!.players).toHaveLength(3);
    expect(rows!.find((r) => r.key === "M")!.players).toHaveLength(3);
    expect(rows!.find((r) => r.key === "D")!.players).toHaveLength(4);
    expect(rows!.find((r) => r.key === "G")!.players).toHaveLength(1);
  });

  it("returns null when there aren't exactly 11 starters", () => {
    expect(buildPitchRows(fullXI(["G", "D", "D", "D", "D", "M", "M", "M", "F", "F"]))).toBeNull();
  });

  it("returns null when any starter has an unresolvable position", () => {
    const starters = fullXI(["G", "D", "D", "D", "D", "M", "M", "M", "F", "F", "SUB"]);
    expect(buildPitchRows(starters)).toBeNull();
  });

  it("returns null when there isn't exactly one goalkeeper", () => {
    const starters = fullXI(["D", "D", "D", "D", "D", "M", "M", "M", "F", "F", "F"]);
    expect(buildPitchRows(starters)).toBeNull();
  });
});
