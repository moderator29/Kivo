import { describe, expect, it } from "vitest";
import {
  buildPitchRows,
  buildTeamSheet,
  describePlayerMarkers,
  formatMatchMinute,
  pitchRowsFromGrid,
  type TeamSheetEvent,
  type TeamSheetLineupEntry,
} from "./team-sheet";

/**
 * Realistic fixture data, in the exact shape `matches/[id]/page.tsx` hands the
 * Match Centre: two full team sheets with benches, formation strings and the
 * provider's own `grid` slots, plus the events of a match that actually
 * happened to them.
 *
 * The clubs are the mock provider's own (`providers/mock.ts`), so nothing here
 * invents a real-world team sheet — the point of the data is its shape, and
 * every assertion below is about how the builder handles that shape.
 */

const HOME = "team-home";
const AWAY = "team-away";

/** A 4-2-3-1: four bands the position letters alone could never separate. */
const HOME_GRID: [string, string][] = [
  ["h1", "1:1"],
  ["h2", "2:1"],
  ["h3", "2:2"],
  ["h4", "2:3"],
  ["h5", "2:4"],
  ["h6", "3:1"],
  ["h7", "3:2"],
  ["h8", "4:1"],
  ["h9", "4:2"],
  ["h10", "4:3"],
  ["h11", "5:1"],
];

const HOME_POSITIONS: Record<string, string> = {
  h1: "G",
  h2: "D",
  h3: "D",
  h4: "D",
  h5: "D",
  h6: "M",
  h7: "M",
  h8: "M",
  h9: "M",
  h10: "M",
  h11: "F",
};

function homeLineup({ withGrid = true }: { withGrid?: boolean } = {}): TeamSheetLineupEntry[] {
  const starters = HOME_GRID.map(([playerId, grid], index) => ({
    teamId: HOME,
    isStarting: true,
    shirtNumber: index + 1,
    position: HOME_POSITIONS[playerId],
    formation: "4-2-3-1",
    grid: withGrid ? grid : null,
    playerId,
    playerName: `Home ${index + 1}`,
  }));
  const bench = ["h12", "h13", "h14"].map((playerId, index) => ({
    teamId: HOME,
    isStarting: false,
    shirtNumber: 12 + index,
    position: index === 0 ? "G" : "F",
    formation: "4-2-3-1",
    grid: null,
    playerId,
    playerName: `Home sub ${index + 1}`,
  }));
  return [...starters, ...bench];
}

function awayLineup(): TeamSheetLineupEntry[] {
  return ["a1", "a2", "a3"].map((playerId, index) => ({
    teamId: AWAY,
    isStarting: index < 2,
    shirtNumber: index + 1,
    position: index === 0 ? "G" : "D",
    formation: "4-4-2",
    grid: null,
    playerId,
    playerName: `Away ${index + 1}`,
  }));
}

function event(overrides: Partial<TeamSheetEvent> & Pick<TeamSheetEvent, "eventType">): TeamSheetEvent {
  return {
    minute: 10,
    addedTime: null,
    teamId: HOME,
    playerId: null,
    relatedPlayerId: null,
    ...overrides,
  };
}

describe("buildTeamSheet", () => {
  it("splits starters from the bench and keeps only this team's rows", () => {
    const sheet = buildTeamSheet(HOME, [...homeLineup(), ...awayLineup()], []);
    expect(sheet.starters).toHaveLength(11);
    expect(sheet.bench).toHaveLength(3);
    expect(sheet.formation).toBe("4-2-3-1");
    expect(sheet.starters.every((p) => p.playerId.startsWith("h"))).toBe(true);
  });

  it("counts goals, assists and cards off this team's own events only", () => {
    const events: TeamSheetEvent[] = [
      event({ eventType: "goal", minute: 23, playerId: "h11", relatedPlayerId: "h10" }),
      event({ eventType: "penalty_goal", minute: 71, playerId: "h11" }),
      event({ eventType: "yellow_card", minute: 40, playerId: "h6" }),
      // The away team's goal must not land on a home player's line even when
      // the ids look similar — the filter is on team_id, not on the player.
      event({ eventType: "goal", minute: 55, teamId: AWAY, playerId: "a2" }),
    ];
    const sheet = buildTeamSheet(HOME, homeLineup(), events);
    const scorer = sheet.starters.find((p) => p.playerId === "h11")!;
    const provider = sheet.starters.find((p) => p.playerId === "h10")!;
    expect(scorer.goals).toBe(2);
    expect(provider.assists).toBe(1);
    expect(sheet.starters.find((p) => p.playerId === "h6")!.yellowCards).toBe(1);
  });

  it("never counts a substitution as an assist", () => {
    // API-Football puts the incoming player in the assist slot on a
    // substitution. Counting related_player_id blindly would credit every
    // bench appearance as an assist — the exact bug player-stats.ts guards.
    const sheet = buildTeamSheet(
      HOME,
      homeLineup(),
      [event({ eventType: "substitution", minute: 64, playerId: "h11", relatedPlayerId: "h13" })],
    );
    expect(sheet.bench.find((p) => p.playerId === "h13")!.assists).toBe(0);
  });

  it("reads a substitution in the provider's own direction: player off, assist on", () => {
    const sheet = buildTeamSheet(
      HOME,
      homeLineup(),
      [event({ eventType: "substitution", minute: 64, playerId: "h11", relatedPlayerId: "h13" })],
    );
    expect(sheet.starters.find((p) => p.playerId === "h11")!.wentOff).toEqual({ minute: 64, added: null });
    expect(sheet.bench.find((p) => p.playerId === "h13")!.cameOn).toEqual({ minute: 64, added: null });
    // And the starter never picks up a "came on".
    expect(sheet.starters.find((p) => p.playerId === "h11")!.cameOn).toBeNull();
  });

  it("counts a second yellow as both a booking and a dismissal", () => {
    const sheet = buildTeamSheet(
      HOME,
      homeLineup(),
      [
        event({ eventType: "yellow_card", minute: 30, playerId: "h2" }),
        event({ eventType: "second_yellow_card", minute: 78, playerId: "h2" }),
      ],
    );
    const sentOff = sheet.starters.find((p) => p.playerId === "h2")!;
    expect(sentOff.yellowCards).toBe(2);
    expect(sentOff.redCards).toBe(1);
  });

  it("keeps an own goal off the scorer's goal tally", () => {
    const sheet = buildTeamSheet(HOME, homeLineup(), [event({ eventType: "own_goal", minute: 12, playerId: "h3" })]);
    const player = sheet.starters.find((p) => p.playerId === "h3")!;
    expect(player.ownGoals).toBe(1);
    expect(player.goals).toBe(0);
  });

  it("lists used substitutes before unused ones", () => {
    const sheet = buildTeamSheet(
      HOME,
      homeLineup(),
      [event({ eventType: "substitution", minute: 80, playerId: "h11", relatedPlayerId: "h14" })],
    );
    expect(sheet.bench[0].playerId).toBe("h14");
    expect(sheet.bench[0].cameOn).not.toBeNull();
    expect(sheet.bench.slice(1).every((p) => p.cameOn === null)).toBe(true);
  });

  it("keeps stoppage time separate from the minute", () => {
    const sheet = buildTeamSheet(
      HOME,
      homeLineup(),
      [event({ eventType: "substitution", minute: 90, addedTime: 3, playerId: "h11", relatedPlayerId: "h13" })],
    );
    expect(sheet.bench.find((p) => p.playerId === "h13")!.cameOn).toEqual({ minute: 90, added: 3 });
    expect(formatMatchMinute({ minute: 90, added: 3 })).toBe("90+3'");
    expect(formatMatchMinute({ minute: 63, added: null })).toBe("63'");
  });

  it("ignores events about players who are not on this team sheet", () => {
    const sheet = buildTeamSheet(HOME, homeLineup(), [event({ eventType: "goal", minute: 5, playerId: "not-named" })]);
    expect(sheet.starters.reduce((total, p) => total + p.goals, 0)).toBe(0);
  });

  it("draws the real formation bands when every starter has a grid slot", () => {
    const sheet = buildTeamSheet(HOME, homeLineup(), []);
    expect(sheet.rowBasis).toBe("formation-slot");
    // A 4-2-3-1 is five lines; the position letters would have collapsed the
    // two-and-three into one nine-man midfield row.
    expect(sheet.rows!.map((row) => row.players.length)).toEqual([1, 3, 2, 4, 1]);
  });

  it("falls back to position lines when the grid is missing, without inventing one", () => {
    const sheet = buildTeamSheet(HOME, homeLineup({ withGrid: false }), []);
    expect(sheet.rowBasis).toBe("position-line");
    expect(sheet.rows!.map((row) => row.key)).toEqual(["F", "M", "D", "G"]);
  });

  it("draws no pitch at all for a partial team sheet", () => {
    const sheet = buildTeamSheet(AWAY, awayLineup(), []);
    expect(sheet.rows).toBeNull();
    expect(sheet.rowBasis).toBeNull();
    // …but the names are still there to list.
    expect(sheet.starters).toHaveLength(2);
    expect(sheet.bench).toHaveLength(1);
  });
});

describe("pitchRowsFromGrid", () => {
  const starters = buildTeamSheet(HOME, homeLineup(), []).starters;

  it("refuses when a single starter is missing a slot", () => {
    const grids = new Map(HOME_GRID as [string, string | null][]);
    grids.set("h7", null);
    expect(pitchRowsFromGrid(starters, grids)).toBeNull();
  });

  it("refuses a malformed slot rather than dropping the player", () => {
    const grids = new Map(HOME_GRID as [string, string | null][]);
    grids.set("h7", "midfield");
    expect(pitchRowsFromGrid(starters, grids)).toBeNull();
  });

  it("refuses when the goalkeeper's line does not hold exactly one player", () => {
    const grids = new Map(HOME_GRID as [string, string | null][]);
    grids.set("h2", "1:2");
    expect(pitchRowsFromGrid(starters, grids)).toBeNull();
  });

  it("prefers the grid over position letters when both are usable", () => {
    const grids = new Map(HOME_GRID as [string, string | null][]);
    const built = buildPitchRows(starters, grids);
    expect(built!.basis).toBe("formation-slot");
  });
});

describe("describePlayerMarkers", () => {
  it("says nothing at all about a player nothing happened to", () => {
    const sheet = buildTeamSheet(HOME, homeLineup(), []);
    expect(describePlayerMarkers(sheet.starters[0])).toBeNull();
  });

  it("spells out every badge the pitch draws", () => {
    const sheet = buildTeamSheet(HOME, homeLineup(), [
      event({ eventType: "goal", minute: 12, playerId: "h11", relatedPlayerId: "h10" }),
      event({ eventType: "yellow_card", minute: 30, playerId: "h11" }),
      event({ eventType: "substitution", minute: 70, playerId: "h11", relatedPlayerId: "h13" }),
    ]);
    expect(describePlayerMarkers(sheet.starters.find((p) => p.playerId === "h11")!)).toBe(
      "1 goal, booked, off at 70'",
    );
    expect(describePlayerMarkers(sheet.starters.find((p) => p.playerId === "h10")!)).toBe("1 assist");
  });
});
