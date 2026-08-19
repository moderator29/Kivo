import { describe, expect, it } from "vitest";
import { pickStandoutPlayer, rankRatedPlayers, rateTeamSheet, ratingsByPlayerId } from "./fixture-ratings";
import { buildTeamSheet, type TeamSheetEvent, type TeamSheetLineupEntry } from "./team-sheet";

/**
 * The adapter between a real team sheet and KIVO's rating engine.
 *
 * The assertions that matter here are the refusals: this is the surface where
 * a fabricated number would be least visible and most damaging, so every case
 * below is about the engine declining to produce one.
 */

const HOME = "team-home";
const AWAY = "team-away";
const FIXTURE = "fixture-1";

function lineup(teamId: string, prefix: string): TeamSheetLineupEntry[] {
  const positions = ["G", "D", "D", "D", "D", "M", "M", "M", "F", "F", "F"];
  const starters = positions.map((position, index) => ({
    teamId,
    isStarting: true,
    shirtNumber: index + 1,
    position,
    formation: "4-3-3",
    grid: null,
    playerId: `${prefix}${index + 1}`,
    playerName: `${prefix} ${index + 1}`,
  }));
  const bench = [1, 2].map((n) => ({
    teamId,
    isStarting: false,
    shirtNumber: 11 + n,
    position: "F",
    formation: "4-3-3",
    grid: null,
    playerId: `${prefix}sub${n}`,
    playerName: `${prefix} sub ${n}`,
  }));
  return [...starters, ...bench];
}

const LINEUPS = [...lineup(HOME, "h"), ...lineup(AWAY, "a")];

const EVENTS: TeamSheetEvent[] = [
  { eventType: "goal", minute: 23, addedTime: null, teamId: HOME, playerId: "h9", relatedPlayerId: "h7" },
  { eventType: "goal", minute: 61, addedTime: null, teamId: HOME, playerId: "h9", relatedPlayerId: null },
  { eventType: "yellow_card", minute: 44, addedTime: null, teamId: AWAY, playerId: "a6", relatedPlayerId: null },
  { eventType: "substitution", minute: 70, addedTime: null, teamId: HOME, playerId: "h11", relatedPlayerId: "hsub1" },
];

function sheets() {
  return {
    home: buildTeamSheet(HOME, LINEUPS, EVENTS),
    away: buildTeamSheet(AWAY, LINEUPS, EVENTS),
  };
}

const FINISHED_HOME = { fixtureId: FIXTURE, fixtureStatus: "finished", goalsFor: 2, goalsAgainst: 0 };
const FINISHED_AWAY = { fixtureId: FIXTURE, fixtureStatus: "finished", goalsFor: 0, goalsAgainst: 2 };

describe("rateTeamSheet", () => {
  it("rates nobody at all before full time", () => {
    const { home } = sheets();
    const rated = rateTeamSheet(home, { fixtureId: FIXTURE, fixtureStatus: "live", goalsFor: 2, goalsAgainst: 0 });
    expect(rated.every((entry) => entry.rating === null)).toBe(true);
  });

  it("rates nobody when the final score is not known", () => {
    const { home } = sheets();
    const rated = rateTeamSheet(home, {
      fixtureId: FIXTURE,
      fixtureStatus: "finished",
      goalsFor: null,
      goalsAgainst: null,
    });
    expect(rated.every((entry) => entry.rating === null)).toBe(true);
  });

  it("leaves an unused substitute unrated rather than giving them a baseline", () => {
    const { home } = sheets();
    const rated = rateTeamSheet(home, FINISHED_HOME);
    const unused = rated.find((entry) => entry.player.playerId === "hsub2")!;
    const used = rated.find((entry) => entry.player.playerId === "hsub1")!;
    expect(unused.rating).toBeNull();
    // The substitute who actually came on has real evidence of involvement,
    // so they are rated — the distinction the engine exists to draw.
    expect(used.rating).not.toBeNull();
  });

  it("never presents a provider rating, because the provider publishes none", () => {
    const { home } = sheets();
    for (const entry of rateTeamSheet(home, FINISHED_HOME)) {
      expect(entry.rating?.providerRating ?? null).toBeNull();
    }
  });

  it("puts the two-goal scorer above his own team-mates", () => {
    const { home } = sheets();
    const ranked = rankRatedPlayers(rateTeamSheet(home, FINISHED_HOME));
    expect(ranked[0].player.playerId).toBe("h9");
    expect(ranked.every((entry, i) => i === 0 || entry.rating!.kivoRating <= ranked[i - 1].rating!.kivoRating)).toBe(
      true,
    );
  });

  it("keeps unrated players out of the ranking entirely", () => {
    const { home } = sheets();
    const ranked = rankRatedPlayers(rateTeamSheet(home, FINISHED_HOME));
    expect(ranked.some((entry) => entry.player.playerId === "hsub2")).toBe(false);
  });
});

describe("ratingsByPlayerId", () => {
  it("omits unrated players rather than mapping them to zero", () => {
    const { home } = sheets();
    const map = ratingsByPlayerId(rateTeamSheet(home, FINISHED_HOME));
    expect(map.has("hsub2")).toBe(false);
    expect(map.get("h9")).toBeGreaterThan(6);
  });
});

describe("pickStandoutPlayer", () => {
  it("names the clear best player across both sides", () => {
    const { home, away } = sheets();
    const standout = pickStandoutPlayer([
      { teamId: HOME, rated: rateTeamSheet(home, FINISHED_HOME) },
      { teamId: AWAY, rated: rateTeamSheet(away, FINISHED_AWAY) },
    ]);
    expect(standout?.player.playerId).toBe("h9");
    expect(standout?.teamId).toBe(HOME);
  });

  it("crowns nobody when the model does not separate the top two", () => {
    // Two goalkeepers, both with a clean sheet and nothing else: identical
    // inputs, identical ratings, and no analytical basis to prefer either.
    const goalless: TeamSheetEvent[] = [];
    const home = buildTeamSheet(HOME, LINEUPS, goalless);
    const away = buildTeamSheet(AWAY, LINEUPS, goalless);
    const standout = pickStandoutPlayer([
      { teamId: HOME, rated: rateTeamSheet(home, { ...FINISHED_HOME, goalsFor: 0, goalsAgainst: 0 }) },
      { teamId: AWAY, rated: rateTeamSheet(away, { ...FINISHED_AWAY, goalsFor: 0, goalsAgainst: 0 }) },
    ]);
    expect(standout).toBeNull();
  });

  it("returns null when nobody could be rated at all", () => {
    const { home } = sheets();
    expect(
      pickStandoutPlayer([
        { teamId: HOME, rated: rateTeamSheet(home, { ...FINISHED_HOME, fixtureStatus: "scheduled" }) },
      ]),
    ).toBeNull();
  });
});
