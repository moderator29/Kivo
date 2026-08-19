import { describe, expect, it } from "vitest";
import { gameweeksOwningFixtures, settledGameweekIds } from "./fantasy-live-scoring";

const SEASON = "season-1";

const gameweeks = [
  { id: "gw1", season_id: SEASON, deadline_at: "2026-08-01T14:00:00Z" },
  { id: "gw2", season_id: SEASON, deadline_at: "2026-08-08T14:00:00Z" },
  { id: "gw3", season_id: SEASON, deadline_at: "2026-08-15T14:00:00Z" },
];

describe("gameweeksOwningFixtures", () => {
  it("picks the gameweek a fixture kicked off inside, not the one that is current", () => {
    // The regression this exists for: once gameweek 2's first match kicks off,
    // `is_current` has already moved to gameweek 3, whose matches are a week
    // away. Live points have to follow the football, not the label.
    expect(
      gameweeksOwningFixtures([{ season_id: SEASON, kickoff_at: "2026-08-08T16:30:00Z" }], gameweeks),
    ).toEqual(["gw2"]);
  });

  it("treats a kickoff exactly on the deadline as inside that gameweek", () => {
    expect(
      gameweeksOwningFixtures([{ season_id: SEASON, kickoff_at: "2026-08-08T14:00:00Z" }], gameweeks),
    ).toEqual(["gw2"]);
  });

  it("returns every gameweek with football in it, oldest deadline first", () => {
    expect(
      gameweeksOwningFixtures(
        [
          { season_id: SEASON, kickoff_at: "2026-08-15T20:00:00Z" },
          { season_id: SEASON, kickoff_at: "2026-08-08T16:30:00Z" },
          { season_id: SEASON, kickoff_at: "2026-08-08T19:00:00Z" },
        ],
        gameweeks,
      ),
    ).toEqual(["gw2", "gw3"]);
  });

  it("keeps seasons apart", () => {
    const other = { id: "other-gw1", season_id: "season-2", deadline_at: "2026-08-08T12:00:00Z" };
    expect(
      gameweeksOwningFixtures([{ season_id: "season-2", kickoff_at: "2026-08-09T12:00:00Z" }], [...gameweeks, other]),
    ).toEqual(["other-gw1"]);
  });

  it("attributes a fixture earlier than every deadline to the first gameweek rather than dropping it", () => {
    expect(
      gameweeksOwningFixtures([{ season_id: SEASON, kickoff_at: "2026-07-30T12:00:00Z" }], gameweeks),
    ).toEqual(["gw1"]);
  });

  it("returns nothing when the season has no gameweeks at all", () => {
    expect(gameweeksOwningFixtures([{ season_id: "season-9", kickoff_at: "2026-08-08T16:30:00Z" }], gameweeks)).toEqual([]);
  });
});

describe("settledGameweekIds", () => {
  it("settles a gameweek only when every stored total says final", () => {
    const settled = settledGameweekIds([
      { gameweek_id: "gw1", status: "final" },
      { gameweek_id: "gw1", status: "final" },
      { gameweek_id: "gw2", status: "final" },
      { gameweek_id: "gw2", status: "provisional" },
    ]);
    expect([...settled]).toEqual(["gw1"]);
  });

  it("treats a gameweek nobody has scored yet as unsettled", () => {
    expect(settledGameweekIds([]).has("gw1")).toBe(false);
  });
});
