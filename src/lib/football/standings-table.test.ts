import { describe, expect, it } from "vitest";
import {
  buildStandingsGroups,
  computeStandingsForm,
  movementSinceLastPlayed,
  type StandingsSourceRow,
} from "./standings-table";

function row(overrides: Partial<StandingsSourceRow> & { teamId: string }): StandingsSourceRow {
  return {
    team: { id: overrides.teamId, name: `Club ${overrides.teamId}`, crestUrl: null },
    position: null,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    ...overrides,
  };
}

describe("movementSinceLastPlayed", () => {
  it("compares against the table as it stood before this club's latest result", () => {
    // The snapshot at played=9 is the one a fan means by "since the weekend".
    // The played=10 snapshot is the CURRENT table and comparing against it
    // would report no movement for a club that had just climbed four places.
    const snapshots = [
      { teamId: "a", position: 3, played: 10 },
      { teamId: "a", position: 7, played: 9 },
      { teamId: "a", position: 8, played: 8 },
    ];
    expect(movementSinceLastPlayed({ position: 3, played: 10 }, snapshots)).toBe("up");
  });

  it("reads a larger position number as a fall", () => {
    const snapshots = [{ teamId: "a", position: 4, played: 9 }];
    expect(movementSinceLastPlayed({ position: 11, played: 10 }, snapshots)).toBe("down");
  });

  it("reports level only when the club genuinely held its place", () => {
    const snapshots = [{ teamId: "a", position: 6, played: 9 }];
    expect(movementSinceLastPlayed({ position: 6, played: 10 }, snapshots)).toBe("level");
  });

  it("returns null rather than level when there is no earlier table", () => {
    // "Hasn't moved" and "KIVO has nothing to compare against" are different
    // facts, and only one of them is safe to draw an arrow (or a dash) for.
    expect(movementSinceLastPlayed({ position: 1, played: 1 }, [])).toBeNull();
    expect(movementSinceLastPlayed({ position: 1, played: 1 }, [{ teamId: "a", position: 1, played: 1 }])).toBeNull();
  });

  it("returns null when either position is missing", () => {
    expect(movementSinceLastPlayed({ position: null, played: 10 }, [{ teamId: "a", position: 4, played: 9 }])).toBeNull();
    expect(movementSinceLastPlayed({ position: 4, played: 10 }, [{ teamId: "a", position: null, played: 9 }])).toBeNull();
  });
});

describe("computeStandingsForm", () => {
  it("maps newest-first results to W/D/L in the same order", () => {
    expect(
      computeStandingsForm([
        { ownScore: 3, oppScore: 1 },
        { ownScore: 0, oppScore: 0 },
        { ownScore: 1, oppScore: 2 },
      ]),
    ).toEqual(["W", "D", "L"]);
  });

  it("takes at most the window and never pads a short one", () => {
    // Five grey placeholders for a club that has played twice would read as
    // three draws.
    expect(computeStandingsForm([{ ownScore: 1, oppScore: 0 }])).toEqual(["W"]);
    expect(
      computeStandingsForm(
        Array.from({ length: 9 }, () => ({ ownScore: 1, oppScore: 0 })),
      ),
    ).toHaveLength(5);
  });
});

describe("buildStandingsGroups", () => {
  it("orders by the competition's own position and never re-derives it", () => {
    // Deliberately points-inverted: the row with FEWER points is stated 1st.
    // Competitions break ties by head-to-head, goals scored, or a play-off,
    // and re-sorting here would substitute one competition's rules for
    // another's while looking authoritative.
    const [group] = buildStandingsGroups({
      rows: [
        row({ teamId: "b", position: 2, points: 40 }),
        row({ teamId: "a", position: 1, points: 38 }),
      ],
    });
    expect(group.rows.map((r) => r.teamId)).toEqual(["a", "b"]);
  });

  it("sorts a row with no stated position last, keeping its arrival order", () => {
    const [group] = buildStandingsGroups({
      rows: [row({ teamId: "x" }), row({ teamId: "a", position: 1 }), row({ teamId: "y" })],
    });
    expect(group.rows.map((r) => r.teamId)).toEqual(["a", "x", "y"]);
  });

  it("splits a group stage into its own tables rather than one long ladder", () => {
    // `position` restarts at 1 in every group, so a single 32-row list would
    // show four clubs claiming first place and no way to tell which table any
    // of them belongs to.
    const groups = buildStandingsGroups({
      rows: [
        row({ teamId: "a1", position: 1, groupLabel: "Group A" }),
        row({ teamId: "b1", position: 1, groupLabel: "Group B" }),
        row({ teamId: "a2", position: 2, groupLabel: "Group A" }),
      ],
    });
    expect(groups.map((g) => g.label)).toEqual(["Group A", "Group B"]);
    expect(groups[0].rows.map((r) => r.teamId)).toEqual(["a1", "a2"]);
  });

  it("renders a straight league as one unlabelled table", () => {
    const groups = buildStandingsGroups({ rows: [row({ teamId: "a", position: 1 })] });
    expect(groups).toHaveLength(1);
    // Null, not "Main" or "League" — a heading nobody wrote is a heading KIVO
    // would be inventing.
    expect(groups[0].label).toBeNull();
  });

  it("carries a zone only for the rows that stated one", () => {
    const [group] = buildStandingsGroups({
      rows: [
        row({ teamId: "a", position: 1, zoneDescription: "Promotion - Champions League (Group Stage)" }),
        row({ teamId: "b", position: 2 }),
      ],
    });
    expect(group.rows[0].zone?.kind).toBe("champions");
    expect(group.rows[1].zone).toBeNull();
  });

  it("computes goal difference and leaves everything else exactly as stated", () => {
    const [group] = buildStandingsGroups({
      rows: [row({ teamId: "a", position: 1, goalsFor: 44, goalsAgainst: 17, points: 51 })],
    });
    expect(group.rows[0].goalDifference).toBe(27);
    expect(group.rows[0].points).toBe(51);
  });

  it("attaches movement and form per team, and neither when there is none", () => {
    const [group] = buildStandingsGroups({
      rows: [row({ teamId: "a", position: 2, played: 10 }), row({ teamId: "b", position: 3, played: 10 })],
      snapshotsByTeamId: new Map([["a", [{ teamId: "a", position: 5, played: 9 }]]]),
      formByTeamId: new Map([["a", ["W", "W", "D"]]]),
    });
    expect(group.rows[0].movement).toBe("up");
    expect(group.rows[0].form).toEqual(["W", "W", "D"]);
    expect(group.rows[1].movement).toBeNull();
    expect(group.rows[1].form).toEqual([]);
  });
});
