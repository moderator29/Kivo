import { describe, expect, it } from "vitest";
import { groupFixturesByCompetition } from "./group-by-competition";

type Fixture = { id: string; competition: { id: string | null; name: string; short_name: string | null } | null };

describe("groupFixturesByCompetition", () => {
  it("groups fixtures by competition id, preserving first-appearance order", () => {
    const fixtures: Fixture[] = [
      { id: "f1", competition: { id: "c1", name: "Premier League", short_name: "EPL" } },
      { id: "f2", competition: { id: "c2", name: "La Liga", short_name: null } },
      { id: "f3", competition: { id: "c1", name: "Premier League", short_name: "EPL" } },
    ];

    const groups = groupFixturesByCompetition(fixtures);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ competitionId: "c1", competitionName: "Premier League" });
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(["f1", "f3"]);
    expect(groups[1]).toMatchObject({ competitionId: "c2", competitionName: "La Liga" });
    expect(groups[1].fixtures.map((f) => f.id)).toEqual(["f2"]);
  });

  it("falls back to the display name as the grouping key when competition id is null", () => {
    const fixtures: Fixture[] = [
      { id: "f1", competition: { id: null, name: "Friendlies", short_name: null } },
      { id: "f2", competition: { id: null, name: "Friendlies", short_name: null } },
    ];

    const groups = groupFixturesByCompetition(fixtures);

    expect(groups).toHaveLength(1);
    expect(groups[0].fixtures).toHaveLength(2);
  });

  it("leaves a fixture with no competition at all unnamed rather than labelling it", () => {
    // Deliberately null, not "Unknown competition". The name renders where a
    // league's name goes, so a placeholder there is indistinguishable from a
    // real competition called that. See src/lib/football/competition-label.ts.
    const fixtures: Fixture[] = [{ id: "f1", competition: null }];
    const groups = groupFixturesByCompetition(fixtures);
    expect(groups[0].competitionName).toBeNull();
  });

  it("groups every unnamed fixture together instead of one group each", () => {
    const fixtures: Fixture[] = [
      { id: "f1", competition: null },
      { id: "f2", competition: null },
    ];
    const groups = groupFixturesByCompetition(fixtures);
    expect(groups).toHaveLength(1);
    expect(groups[0].fixtures.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupFixturesByCompetition([])).toEqual([]);
  });
});
