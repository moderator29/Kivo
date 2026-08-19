import { describe, expect, it } from "vitest";
import { classifyStandingsZone, groupStandings, zoneKey, type StandingsRow } from "./standings-table";

function row(overrides: Partial<StandingsRow> & Pick<StandingsRow, "teamId">): StandingsRow {
  return {
    teamName: "A club",
    crestUrl: null,
    played: 10,
    won: 5,
    drawn: 2,
    lost: 3,
    goalsFor: 14,
    goalsAgainst: 11,
    points: 17,
    position: 1,
    zoneDescription: null,
    groupLabel: null,
    ...overrides,
  };
}

describe("classifyStandingsZone", () => {
  it("reads the competition's own phrases", () => {
    expect(classifyStandingsZone("Promotion - Champions League (Group Stage)")).toBe("up");
    expect(classifyStandingsZone("Relegation - Championship")).toBe("down");
    expect(classifyStandingsZone("Promotion - Europa League (Group Stage)")).toBe("secondary");
    expect(classifyStandingsZone("Promotion - Conference League (Qualification)")).toBe("secondary");
  });

  it("reads a play-off as a chance rather than a place, whichever way it points", () => {
    expect(classifyStandingsZone("Relegation Play-off")).toBe("secondary");
    expect(classifyStandingsZone("Promotion Play-off")).toBe("secondary");
    expect(classifyStandingsZone("Promotion - Champions League (Qualification)")).toBe("secondary");
  });

  it("marks a phrase it does not recognise rather than dropping it", () => {
    expect(classifyStandingsZone("Copa Libertadores")).toBe("unclassified");
  });

  it("says nothing at all about a row with no published zone", () => {
    expect(classifyStandingsZone(null)).toBeNull();
    expect(classifyStandingsZone("")).toBeNull();
  });
});

describe("zoneKey", () => {
  it("lists each distinct phrase once, in the order the table reaches it", () => {
    const key = zoneKey([
      row({ teamId: "1", position: 1, zoneDescription: "Promotion - Champions League (Group Stage)" }),
      row({ teamId: "2", position: 2, zoneDescription: "Promotion - Champions League (Group Stage)" }),
      row({ teamId: "3", position: 3, zoneDescription: null }),
      row({ teamId: "4", position: 4, zoneDescription: "Relegation - Championship" }),
    ]);
    expect(key).toEqual([
      { description: "Promotion - Champions League (Group Stage)", tone: "up" },
      { description: "Relegation - Championship", tone: "down" },
    ]);
  });

  it("is empty for a table that published no zones", () => {
    expect(zoneKey([row({ teamId: "1" }), row({ teamId: "2" })])).toEqual([]);
  });
});

describe("groupStandings", () => {
  it("keeps an ordinary league as one table", () => {
    const groups = groupStandings([row({ teamId: "1" }), row({ teamId: "2" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
  });

  it("splits a group stage into the tables it actually is", () => {
    const groups = groupStandings([
      row({ teamId: "1", groupLabel: "Group A" }),
      row({ teamId: "2", groupLabel: "Group B" }),
      row({ teamId: "3", groupLabel: "Group A" }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Group A", "Group B"]);
    expect(groups[0].rows.map((entry) => entry.teamId)).toEqual(["1", "3"]);
  });
});
