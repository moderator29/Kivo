import { describe, expect, it } from "vitest";
import { resolveVisibleMatchTabs, type MatchCompetitionCoverage, type MatchDataPresence } from "./match-tabs";
import type { FixtureStatus } from "./fixture-status";

const NOTHING: MatchDataPresence = {
  timeline: false,
  lineups: false,
  ratings: false,
  stats: false,
  players: false,
  heatmap: false,
  standings: false,
  headToHead: false,
};

const EVERYTHING: MatchDataPresence = {
  timeline: true,
  lineups: true,
  ratings: true,
  stats: true,
  players: true,
  heatmap: true,
  standings: true,
  headToHead: true,
};

function tabs(
  status: FixtureStatus,
  present: Partial<MatchDataPresence> = {},
  coverage: MatchCompetitionCoverage = null,
) {
  return resolveVisibleMatchTabs({ status, present: { ...NOTHING, ...present }, coverage });
}

describe("resolveVisibleMatchTabs", () => {
  it("always leads with Overview and ends with the Room", () => {
    for (const status of ["scheduled", "live", "finished", "postponed"] as FixtureStatus[]) {
      const visible = tabs(status);
      expect(visible[0]).toBe("overview");
      expect(visible[visible.length - 1]).toBe("room");
    }
  });

  it("offers Lineups on an empty scheduled fixture, because that is when a fan asks for it", () => {
    // The founder's "lineup not showing": an unpublished team sheet used to
    // remove the tab entirely, an hour before the exact moment it lands.
    expect(tabs("scheduled")).toContain("lineups");
  });

  it("does not offer a timeline or statistics before kick-off", () => {
    const visible = tabs("scheduled");
    expect(visible).not.toContain("timeline");
    expect(visible).not.toContain("stats");
  });

  it("offers an empty timeline and empty statistics once the match is under way", () => {
    const visible = tabs("live");
    expect(visible).toContain("timeline");
    expect(visible).toContain("stats");
  });

  it("hides a section the data source says this competition never publishes", () => {
    const visible = tabs("finished", {}, { events: false, lineups: false, statistics: false, standings: false });
    expect(visible).not.toContain("timeline");
    expect(visible).not.toContain("lineups");
    expect(visible).not.toContain("stats");
    expect(visible).not.toContain("standings");
    expect(visible).toEqual(["overview", "room"]);
  });

  it("treats an unknown coverage flag as unknown, never as a denial", () => {
    const visible = tabs("finished", {}, { events: null, lineups: null, statistics: null, standings: null });
    expect(visible).toContain("timeline");
    expect(visible).toContain("lineups");
    expect(visible).toContain("stats");
    expect(visible).toContain("standings");
  });

  it("still shows a section that holds data even when coverage denies it", () => {
    // Real rows beat a stale registry: KIVO is looking at the events.
    const visible = tabs("finished", { timeline: true }, { events: false, lineups: null, statistics: null, standings: null });
    expect(visible).toContain("timeline");
  });

  it("promises nothing on a match that will not be played", () => {
    const visible = tabs("postponed");
    expect(visible).toEqual(["overview", "standings", "room"]);
  });

  it("keeps what a called-off match already accumulated", () => {
    const visible = tabs("postponed", { lineups: true });
    expect(visible).toContain("lineups");
  });

  it("never soft-gates KIVO's own computations", () => {
    const visible = tabs("finished");
    expect(visible).not.toContain("ratings");
    expect(visible).not.toContain("heatmap");
    expect(visible).not.toContain("players");
  });

  it("offers every section on a finished match that holds all of it", () => {
    expect(tabs("finished", EVERYTHING)).toEqual([
      "overview",
      "timeline",
      "lineups",
      "ratings",
      "stats",
      "players",
      "heatmap",
      "h2h",
      "standings",
      "room",
    ]);
  });

  it("keeps one stable order however few sections survive", () => {
    const visible = tabs("finished", { stats: true, headToHead: true });
    expect(visible).toEqual(["overview", "timeline", "lineups", "stats", "h2h", "standings", "room"]);
  });
});
