import { describe, expect, it } from "vitest";
import {
  buildPlayerMatchLog,
  hasCareerProgression,
  summarizeCareerBySeason,
  type PlayerFixtureInput,
  type SeasonStatisticsRow,
} from "@/components/players/player-career";

const PLAYER = "player-1";
const OWN_TEAM = "team-own";
const OPP_TEAM = "team-opp";

function fixture(partial: Partial<PlayerFixtureInput> & { fixtureId: string }): PlayerFixtureInput {
  return {
    kickoffAt: "2026-08-01T14:00:00Z",
    status: "finished",
    teamId: OWN_TEAM,
    isStarting: true,
    homeTeamId: OWN_TEAM,
    awayTeamId: OPP_TEAM,
    homeScore: 2,
    awayScore: 1,
    ...partial,
  };
}

describe("buildPlayerMatchLog", () => {
  it("resolves the result from the player's own team's side, home or away", () => {
    const [home, away] = buildPlayerMatchLog({
      playerId: PLAYER,
      position: "Midfielder",
      fixtures: [
        fixture({ fixtureId: "f1", kickoffAt: "2026-08-02T14:00:00Z" }),
        fixture({
          fixtureId: "f2",
          kickoffAt: "2026-08-01T14:00:00Z",
          homeTeamId: OPP_TEAM,
          awayTeamId: OWN_TEAM,
          homeScore: 3,
          awayScore: 0,
        }),
      ],
      subjectEvents: [],
      relatedEvents: [],
      minutesByFixture: new Map(),
    });

    expect(home.result).toBe("W");
    expect(home.ownScore).toBe(2);
    expect(home.isHome).toBe(true);
    expect(home.opponentTeamId).toBe(OPP_TEAM);

    expect(away.result).toBe("L");
    expect(away.ownScore).toBe(0);
    expect(away.isHome).toBe(false);
  });

  it("sorts newest first", () => {
    const log = buildPlayerMatchLog({
      playerId: PLAYER,
      position: null,
      fixtures: [
        fixture({ fixtureId: "old", kickoffAt: "2026-01-01T14:00:00Z" }),
        fixture({ fixtureId: "new", kickoffAt: "2026-05-01T14:00:00Z" }),
      ],
      subjectEvents: [],
      relatedEvents: [],
      minutesByFixture: new Map(),
    });
    expect(log.map((entry) => entry.fixtureId)).toEqual(["new", "old"]);
  });

  it("counts goals, assists and cards against the right fixture only", () => {
    const [first, second] = buildPlayerMatchLog({
      playerId: PLAYER,
      position: "Forward",
      fixtures: [
        fixture({ fixtureId: "f1", kickoffAt: "2026-08-02T14:00:00Z" }),
        fixture({ fixtureId: "f2", kickoffAt: "2026-08-01T14:00:00Z" }),
      ],
      subjectEvents: [
        { fixtureId: "f1", eventType: "goal" },
        { fixtureId: "f1", eventType: "penalty_goal" },
        { fixtureId: "f1", eventType: "yellow_card" },
        { fixtureId: "f2", eventType: "second_yellow_card" },
      ],
      relatedEvents: [{ fixtureId: "f1", eventType: "goal" }],
      minutesByFixture: new Map(),
    });

    expect(first.goals).toBe(2);
    expect(first.assists).toBe(1);
    expect(first.yellowCards).toBe(1);
    expect(second.goals).toBe(0);
    expect(second.redCards).toBe(1);
  });

  it("reads a substitution's related slot as this player coming on", () => {
    const [entry] = buildPlayerMatchLog({
      playerId: PLAYER,
      position: "Forward",
      fixtures: [fixture({ fixtureId: "f1", isStarting: false })],
      subjectEvents: [],
      relatedEvents: [{ fixtureId: "f1", eventType: "substitution" }],
      minutesByFixture: new Map(),
    });
    expect(entry.cameOnFromBench).toBe(true);
    // The engine rates them precisely because there is evidence they played.
    expect(entry.rating).not.toBeNull();
  });

  it("refuses a rating for an unused substitute", () => {
    const [entry] = buildPlayerMatchLog({
      playerId: PLAYER,
      position: "Forward",
      fixtures: [fixture({ fixtureId: "f1", isStarting: false })],
      subjectEvents: [],
      relatedEvents: [],
      minutesByFixture: new Map(),
    });
    expect(entry.cameOnFromBench).toBe(false);
    expect(entry.rating).toBeNull();
  });

  it("leaves minutes null rather than assuming a starter played ninety", () => {
    const [entry] = buildPlayerMatchLog({
      playerId: PLAYER,
      position: "Defender",
      fixtures: [fixture({ fixtureId: "f1" })],
      subjectEvents: [],
      relatedEvents: [],
      minutesByFixture: new Map(),
    });
    expect(entry.minutesPlayed).toBeNull();
  });

  it("has no result or rating for a match that has not finished", () => {
    const [entry] = buildPlayerMatchLog({
      playerId: PLAYER,
      position: "Defender",
      fixtures: [fixture({ fixtureId: "f1", status: "scheduled", homeScore: null, awayScore: null })],
      subjectEvents: [],
      relatedEvents: [],
      minutesByFixture: new Map(),
    });
    expect(entry.result).toBeNull();
    expect(entry.rating).toBeNull();
  });
});

describe("summarizeCareerBySeason", () => {
  const rows: SeasonStatisticsRow[] = [
    { season_year: 2025, appearances: 20, minutes_played: 1700, goals: 8, assists: 3 },
    { season_year: 2025, appearances: 5, minutes_played: 400, goals: 2, assists: null },
    { season_year: 2024, appearances: 10, minutes_played: null, goals: null, assists: null },
  ];

  it("groups by season, newest first, and sums the competitions in each", () => {
    const seasons = summarizeCareerBySeason(rows);
    expect(seasons.map((season) => season.seasonYear)).toEqual([2025, 2024]);
    expect(seasons[0].competitions).toBe(2);
    expect(seasons[0].appearances).toBe(25);
    expect(seasons[0].goals).toBe(10);
  });

  it("says how many competitions a partial total actually spans", () => {
    const seasons = summarizeCareerBySeason(rows);
    expect(seasons[0].assists).toBe(3);
    expect(seasons[0].assistsReported).toBe(1);
    expect(seasons[0].appearancesReported).toBe(2);
  });

  it("keeps an unreported column null rather than turning it into zero", () => {
    const seasons = summarizeCareerBySeason(rows);
    expect(seasons[1].goals).toBeNull();
    expect(seasons[1].minutes).toBeNull();
    expect(seasons[1].appearances).toBe(10);
  });

  it("needs two seasons with real output before it will call it a progression", () => {
    expect(hasCareerProgression(summarizeCareerBySeason(rows))).toBe(false);
    expect(
      hasCareerProgression(
        summarizeCareerBySeason([
          ...rows,
          { season_year: 2023, appearances: 12, minutes_played: 900, goals: 4, assists: 1 },
        ]),
      ),
    ).toBe(true);
  });
});
