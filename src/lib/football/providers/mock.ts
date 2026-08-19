import "server-only";
import type {
  FootballDataProvider,
  NormalizedCompetitionCoverage,
  NormalizedFixture,
  NormalizedFixturePlayerStatistics,
  NormalizedFixtureStatistics,
  NormalizedInjury,
  NormalizedLineups,
  NormalizedManager,
  NormalizedMatchEvent,
  NormalizedPlayer,
  NormalizedPlayerSeasonStatistics,
  NormalizedStandingRow,
  NormalizedTopScorer,
  NormalizedTransfer,
} from "../types";

/**
 * Development-only fixture data so UI can be built without spending API-Football's
 * free-tier quota. Never reachable in production — see the guard in ../index.ts.
 */
const MOCK_FIXTURES: NormalizedFixture[] = [
  {
    provider: "mock",
    providerId: "mock-1",
    competitionProviderId: "mock-competition-1",
    competitionName: "Nigeria Premier Football League",
    season: 2026,
    kickoffAt: new Date().toISOString(),
    status: "scheduled",
    minute: null,
    matchday: 1,
    homeTeam: { providerId: "mock-team-1", name: "Remo Stars", shortName: "REM", crestUrl: null },
    awayTeam: { providerId: "mock-team-2", name: "Enyimba", shortName: "ENY", crestUrl: null },
    homeScore: null,
    awayScore: null,
    homeScoreHt: null,
    awayScoreHt: null,
    venueProviderId: "mock-venue-1",
    venueName: "Remo Stars Stadium",
    retrievedAt: new Date().toISOString(),
  },
];

/** Deliberately mirrors the real provider's limitation: no dateOfBirth/nationality
 * from a squads-style listing — see the doc comment on getSquad() in api-football.ts.
 * photoUrl stays null too, same zero-fake-data rule — there is no real photo to mock. */
const MOCK_SQUADS: Record<string, NormalizedPlayer[]> = {
  "mock-team-1": [
    { providerId: "mock-player-1", fullName: "Chidi Okafor", knownAs: null, dateOfBirth: null, nationality: null, position: "Goalkeeper", photoUrl: null },
    { providerId: "mock-player-2", fullName: "Tunde Bakare", knownAs: null, dateOfBirth: null, nationality: null, position: "Defender", photoUrl: null },
    { providerId: "mock-player-3", fullName: "Femi Adisa", knownAs: null, dateOfBirth: null, nationality: null, position: "Midfielder", photoUrl: null },
    { providerId: "mock-player-4", fullName: "Kelechi Uzo", knownAs: "K. Uzo", dateOfBirth: null, nationality: null, position: "Attacker", photoUrl: null },
  ],
  "mock-team-2": [
    { providerId: "mock-player-5", fullName: "Emeka Nwosu", knownAs: null, dateOfBirth: null, nationality: null, position: "Goalkeeper", photoUrl: null },
    { providerId: "mock-player-6", fullName: "Yusuf Danladi", knownAs: null, dateOfBirth: null, nationality: null, position: "Defender", photoUrl: null },
    { providerId: "mock-player-7", fullName: "Obinna Chukwu", knownAs: null, dateOfBirth: null, nationality: null, position: "Midfielder", photoUrl: null },
    { providerId: "mock-player-8", fullName: "Ahmed Musa Jr", knownAs: null, dateOfBirth: null, nationality: null, position: "Attacker", photoUrl: null },
  ],
};

const MOCK_MANAGERS: Record<string, NormalizedManager | null> = {
  "mock-team-1": { providerId: "mock-manager-1", fullName: "Segun Adewale", nationality: "Nigeria", dateOfBirth: "1975-04-02" },
  "mock-team-2": { providerId: "mock-manager-2", fullName: "Ifeanyi Eze", nationality: "Nigeria", dateOfBirth: "1980-09-15" },
};

const MOCK_LINEUPS: NormalizedLineups = {
  fixtureProviderId: "mock-1",
  teams: [
    {
      team: { providerId: "mock-team-1", name: "Remo Stars", shortName: "REM", crestUrl: null },
      // Only 4 mock entries (not a full XI) — deliberately too few to trigger the
      // real formation pitch view, which requires all 11 real starters resolved.
      // This "formation" string is included only so the mock's shape matches the
      // real provider's; the UI still falls back to the plain list for this fixture.
      formation: "4-3-3",
      entries: [
        { playerProviderId: "mock-player-1", playerName: "Chidi Okafor", isStarting: true, shirtNumber: 1, position: "G", grid: "1:1" },
        { playerProviderId: "mock-player-2", playerName: "Tunde Bakare", isStarting: true, shirtNumber: 4, position: "D", grid: "2:2" },
        { playerProviderId: "mock-player-3", playerName: "Femi Adisa", isStarting: true, shirtNumber: 8, position: "M", grid: "3:2" },
        { playerProviderId: "mock-player-4", playerName: "Kelechi Uzo", isStarting: false, shirtNumber: 11, position: "F", grid: null },
      ],
    },
    {
      team: { providerId: "mock-team-2", name: "Enyimba", shortName: "ENY", crestUrl: null },
      formation: "4-4-2",
      entries: [
        { playerProviderId: "mock-player-5", playerName: "Emeka Nwosu", isStarting: true, shirtNumber: 1, position: "G", grid: "1:1" },
        { playerProviderId: "mock-player-6", playerName: "Yusuf Danladi", isStarting: true, shirtNumber: 5, position: "D", grid: "2:3" },
        { playerProviderId: "mock-player-7", playerName: "Obinna Chukwu", isStarting: true, shirtNumber: 6, position: "M", grid: "3:3" },
        { playerProviderId: "mock-player-8", playerName: "Ahmed Musa Jr", isStarting: false, shirtNumber: 9, position: "F", grid: null },
      ],
    },
  ],
};

const MOCK_EVENTS: NormalizedMatchEvent[] = [
  {
    providerId: "mock-1:mock-team-1:mock-player-4:63:0:Goal:Normal Goal",
    teamProviderId: "mock-team-1",
    playerProviderId: "mock-player-4",
    playerName: "Kelechi Uzo",
    relatedPlayerProviderId: null,
    relatedPlayerName: null,
    eventType: "goal",
    minute: 63,
    addedTime: null,
    detail: "Normal Goal",
  },
  {
    providerId: "mock-1:mock-team-2:mock-player-6:78:0:Card:Yellow Card",
    teamProviderId: "mock-team-2",
    playerProviderId: "mock-player-6",
    playerName: "Yusuf Danladi",
    relatedPlayerProviderId: null,
    relatedPlayerName: null,
    eventType: "yellow_card",
    minute: 78,
    addedTime: null,
    detail: "Yellow Card",
  },
];

/** Deliberately leaves the away side's expectedGoals null — not every competition
 * reports xG on the free tier (see NormalizedFixtureTeamStatistics.expectedGoals'
 * doc comment), so the mock mirrors that rather than fabricating a number for both. */
const MOCK_STATISTICS: NormalizedFixtureStatistics = {
  fixtureProviderId: "mock-1",
  teams: [
    {
      team: { providerId: "mock-team-1", name: "Remo Stars", shortName: "REM", crestUrl: null },
      shotsTotal: 13,
      shotsOnTarget: 6,
      shotsOffTarget: 4,
      shotsBlocked: 3,
      shotsInsideBox: 8,
      shotsOutsideBox: 5,
      fouls: 9,
      corners: 6,
      offsides: 2,
      possessionPct: 58,
      yellowCards: 1,
      redCards: 0,
      saves: 3,
      passesTotal: 512,
      passesAccurate: 441,
      passesPct: 86,
      expectedGoals: 1.74,
    },
    {
      team: { providerId: "mock-team-2", name: "Enyimba", shortName: "ENY", crestUrl: null },
      shotsTotal: 9,
      shotsOnTarget: 3,
      shotsOffTarget: 4,
      shotsBlocked: 2,
      shotsInsideBox: 5,
      shotsOutsideBox: 4,
      fouls: 12,
      corners: 3,
      offsides: 1,
      possessionPct: 42,
      yellowCards: 2,
      redCards: 0,
      saves: 4,
      passesTotal: 371,
      passesAccurate: 298,
      passesPct: 80,
      expectedGoals: null,
    },
  ],
};

const MOCK_STANDINGS: NormalizedStandingRow[] = [
  {
    provider: "mock",
    team: { providerId: "mock-team-1", name: "Remo Stars", shortName: "REM", crestUrl: null },
    rank: 1,
    played: 10,
    won: 7,
    drawn: 2,
    lost: 1,
    goalsFor: 20,
    goalsAgainst: 8,
    points: 23,
  },
  {
    provider: "mock",
    team: { providerId: "mock-team-2", name: "Enyimba", shortName: "ENY", crestUrl: null },
    rank: 2,
    played: 10,
    won: 6,
    drawn: 2,
    lost: 2,
    goalsFor: 17,
    goalsAgainst: 10,
    points: 20,
  },
];

/** Real-shaped mock transfer history for mock-player-4 (Kelechi Uzo) — deliberately
 * covers all four known transfer_type buckets plus one "N/A" fee to exercise the
 * "unknown" fallback, same intent as the other MOCK_* fixtures in this file. */
const MOCK_TRANSFERS: Record<string, NormalizedTransfer[]> = {
  "mock-player-4": [
    {
      providerId: "mock-player-4:2025-07-01:mock-team-2:mock-team-1:€2.5M",
      playerProviderId: "mock-player-4",
      fromTeamProviderId: "mock-team-2",
      fromTeamName: "Enyimba",
      toTeamProviderId: "mock-team-1",
      toTeamName: "Remo Stars",
      transferDate: "2025-07-01",
      feeText: "€2.5M",
      transferType: "transfer",
    },
    {
      providerId: "mock-player-4:2024-01-15:mock-team-3:mock-team-2:Loan",
      playerProviderId: "mock-player-4",
      fromTeamProviderId: "mock-team-3",
      fromTeamName: "Rivers United",
      toTeamProviderId: "mock-team-2",
      toTeamName: "Enyimba",
      transferDate: "2024-01-15",
      feeText: "Loan",
      transferType: "loan",
    },
    {
      providerId: "mock-player-4:2023-06-30:mock-team-2:mock-team-3:End of loan",
      playerProviderId: "mock-player-4",
      fromTeamProviderId: "mock-team-2",
      fromTeamName: "Enyimba",
      toTeamProviderId: "mock-team-3",
      toTeamName: "Rivers United",
      transferDate: "2023-06-30",
      feeText: "End of loan",
      transferType: "end_of_loan",
    },
    {
      providerId: "mock-player-4:2022-08-01:x:mock-team-3:Free",
      playerProviderId: "mock-player-4",
      fromTeamProviderId: null,
      fromTeamName: null,
      toTeamProviderId: "mock-team-3",
      toTeamName: "Rivers United",
      transferDate: "2022-08-01",
      feeText: "Free",
      transferType: "free",
    },
    {
      providerId: "mock-player-4:2021-02-10:x:mock-team-2:N/A",
      playerProviderId: "mock-player-4",
      fromTeamProviderId: null,
      fromTeamName: "Youth academy",
      toTeamProviderId: "mock-team-2",
      toTeamName: "Enyimba",
      transferDate: "2021-02-10",
      feeText: "N/A",
      transferType: "unknown",
    },
  ],
};

/**
 * Per-player match statistics for the mock fixture. Numbers are small and
 * obviously synthetic; the point is the SHAPE — including that a keeper's
 * `saves` is a number and an outfielder's is null, so a consumer that treats
 * null as zero shows up in development rather than in production.
 */
const MOCK_FIXTURE_PLAYER_STATS: NormalizedFixturePlayerStatistics = {
  fixtureProviderId: "mock-1",
  players: [
    {
      playerProviderId: "mock-player-1",
      playerName: "Chidi Okafor",
      teamProviderId: "mock-team-1",
      minutesPlayed: 90,
      position: "G",
      isSubstitute: false,
      providerRating: 6.8,
      shotsTotal: null,
      shotsOnTarget: null,
      goals: 0,
      assists: 0,
      goalsConceded: 1,
      saves: 4,
      passesTotal: 24,
      passesKey: 0,
      passAccuracy: 71,
      tacklesTotal: null,
      blocks: null,
      interceptions: null,
      duelsTotal: 1,
      duelsWon: 1,
      dribblesAttempted: null,
      dribblesSucceeded: null,
      dribbledPast: null,
      foulsDrawn: null,
      foulsCommitted: null,
      yellowCards: 0,
      redCards: 0,
      offsides: null,
      penaltiesWon: null,
      penaltiesCommitted: null,
      penaltiesScored: null,
      penaltiesMissed: null,
      penaltiesSaved: 0,
    },
    {
      playerProviderId: "mock-player-2",
      playerName: "Tunde Bakare",
      teamProviderId: "mock-team-1",
      minutesPlayed: 90,
      position: "D",
      isSubstitute: false,
      providerRating: 7.1,
      shotsTotal: 1,
      shotsOnTarget: 0,
      goals: 0,
      assists: 0,
      goalsConceded: null,
      saves: null,
      passesTotal: 51,
      passesKey: 1,
      passAccuracy: 84,
      tacklesTotal: 4,
      blocks: 2,
      interceptions: 3,
      duelsTotal: 11,
      duelsWon: 7,
      dribblesAttempted: 1,
      dribblesSucceeded: 0,
      dribbledPast: 2,
      foulsDrawn: 1,
      foulsCommitted: 2,
      yellowCards: 1,
      redCards: 0,
      offsides: 0,
      penaltiesWon: null,
      penaltiesCommitted: null,
      penaltiesScored: null,
      penaltiesMissed: null,
      penaltiesSaved: null,
    },
    {
      playerProviderId: "mock-player-3",
      playerName: "Femi Adisa",
      teamProviderId: "mock-team-1",
      minutesPlayed: 78,
      position: "M",
      isSubstitute: false,
      providerRating: 7.6,
      shotsTotal: 2,
      shotsOnTarget: 1,
      goals: 0,
      assists: 1,
      goalsConceded: null,
      saves: null,
      passesTotal: 63,
      passesKey: 3,
      passAccuracy: 88,
      tacklesTotal: 2,
      blocks: 0,
      interceptions: 1,
      duelsTotal: 9,
      duelsWon: 5,
      dribblesAttempted: 4,
      dribblesSucceeded: 3,
      dribbledPast: 1,
      foulsDrawn: 3,
      foulsCommitted: 1,
      yellowCards: 0,
      redCards: 0,
      offsides: 0,
      penaltiesWon: null,
      penaltiesCommitted: null,
      penaltiesScored: null,
      penaltiesMissed: null,
      penaltiesSaved: null,
    },
  ],
};

/**
 * A coverage declaration for the mock competition. `injuries: false` and
 * `fixturePlayerStatistics: true` are chosen so both sides of the registry's
 * three-way distinction are reachable in development: a tab that says
 * "this competition never publishes this" and one that says "not synced yet".
 * `odds: null` exercises the third — unknown.
 */
const MOCK_COVERAGE: NormalizedCompetitionCoverage[] = [
  {
    competitionProviderId: "mock-competition-1",
    competitionName: "Nigeria Premier Football League",
    season: 2026,
    fixtureEvents: true,
    fixtureLineups: true,
    fixtureStatistics: true,
    fixturePlayerStatistics: true,
    standings: true,
    players: true,
    topScorers: true,
    topAssists: false,
    topCards: false,
    injuries: false,
    predictions: false,
    odds: null,
    raw: null,
  },
];

const MOCK_TOP_SCORERS: NormalizedTopScorer[] = [
  {
    rank: 1,
    playerProviderId: "mock-player-4",
    playerName: "Kelechi Uzo",
    playerPhotoUrl: null,
    teamProviderId: "mock-team-1",
    teamName: "Remo Stars",
    goals: 9,
    assists: 2,
    penaltiesScored: 1,
    appearances: 14,
    minutesPlayed: 1150,
  },
  {
    rank: 2,
    playerProviderId: "mock-player-8",
    playerName: "Ahmed Musa Jr",
    playerPhotoUrl: null,
    teamProviderId: "mock-team-2",
    teamName: "Enyimba",
    goals: 7,
    assists: 4,
    penaltiesScored: 0,
    appearances: 15,
    minutesPlayed: 1280,
  },
];

/** One player, two competitions — the split that makes a competition breakdown
 * testable at all, and the reason season statistics are stored per competition
 * rather than summed. */
const MOCK_PLAYER_SEASON_STATS: Record<string, NormalizedPlayerSeasonStatistics[]> = {
  "mock-player-4": [
    {
      playerProviderId: "mock-player-4",
      playerName: "Kelechi Uzo",
      competitionProviderId: "mock-competition-1",
      competitionName: "Nigeria Premier Football League",
      season: 2026,
      teamProviderId: "mock-team-1",
      teamName: "Remo Stars",
      position: "Attacker",
      appearances: 14,
      lineups: 12,
      minutesPlayed: 1150,
      providerRating: 7.4,
      goals: 9,
      assists: 2,
      goalsConceded: null,
      saves: null,
      shotsTotal: 38,
      shotsOnTarget: 19,
      passesTotal: 310,
      passesKey: 21,
      passAccuracy: 79,
      tacklesTotal: 9,
      blocks: 1,
      interceptions: 4,
      duelsTotal: 121,
      duelsWon: 58,
      dribblesAttempted: 47,
      dribblesSucceeded: 26,
      foulsDrawn: 24,
      foulsCommitted: 11,
      yellowCards: 2,
      redCards: 0,
      penaltiesScored: 1,
      penaltiesMissed: 0,
    },
    {
      playerProviderId: "mock-player-4",
      playerName: "Kelechi Uzo",
      competitionProviderId: "mock-competition-2",
      competitionName: "Mock Federation Cup",
      season: 2026,
      teamProviderId: "mock-team-1",
      teamName: "Remo Stars",
      position: "Attacker",
      appearances: 3,
      lineups: 2,
      minutesPlayed: 190,
      providerRating: 7.0,
      goals: 2,
      assists: 0,
      goalsConceded: null,
      saves: null,
      shotsTotal: 6,
      shotsOnTarget: 3,
      passesTotal: 41,
      passesKey: 2,
      passAccuracy: 74,
      tacklesTotal: 1,
      blocks: 0,
      interceptions: 0,
      duelsTotal: 18,
      duelsWon: 8,
      dribblesAttempted: 7,
      dribblesSucceeded: 4,
      foulsDrawn: 3,
      foulsCommitted: 2,
      yellowCards: 0,
      redCards: 0,
      penaltiesScored: 0,
      penaltiesMissed: 0,
    },
  ],
};

export class MockFootballProvider implements FootballDataProvider {
  readonly name = "mock";

  /** The mock never talks to a real provider, so there's no real quota header
   * to report — null, not a fabricated number (see FootballDataProvider's doc
   * comment on this method). */
  getQuotaRemaining(): number | null {
    return null;
  }

  /** RECOMMENDATIONS.md item 65: no real upstream response ever exists to
   * sample — null, honestly, same rationale as getQuotaRemaining above. */
  getLastRawResponseSample(): unknown | null {
    return null;
  }

  async getFixturesByDate(): Promise<NormalizedFixture[]> {
    return MOCK_FIXTURES;
  }

  /**
   * Empty, always — and that is the honest mock, not a gap.
   *
   * The mock fixture is `scheduled`, so nothing is in play, so the live feed
   * returns nothing. Returning a fabricated in-play match here would let a
   * developer build and "verify" a live surface against a match that does not
   * exist, which is exactly the confidence this file's other comments exist to
   * withhold.
   */
  async getLiveFixtures(): Promise<NormalizedFixture[]> {
    return MOCK_FIXTURES.filter((fixture) => fixture.status === "live" || fixture.status === "halftime");
  }

  async getFixtureById(providerId: string): Promise<NormalizedFixture | null> {
    return MOCK_FIXTURES.find((f) => f.providerId === providerId) ?? null;
  }

  async getStandings(): Promise<NormalizedStandingRow[]> {
    return MOCK_STANDINGS;
  }

  async getSquad(teamProviderId: string): Promise<NormalizedPlayer[]> {
    return MOCK_SQUADS[teamProviderId] ?? [];
  }

  async getManager(teamProviderId: string): Promise<NormalizedManager | null> {
    return MOCK_MANAGERS[teamProviderId] ?? null;
  }

  async getLineups(fixtureProviderId: string): Promise<NormalizedLineups | null> {
    return fixtureProviderId === MOCK_LINEUPS.fixtureProviderId ? MOCK_LINEUPS : null;
  }

  async getMatchEvents(fixtureProviderId: string): Promise<NormalizedMatchEvent[]> {
    return fixtureProviderId === "mock-1" ? MOCK_EVENTS : [];
  }

  async getPlayerTransfers(playerProviderId: string): Promise<NormalizedTransfer[]> {
    return MOCK_TRANSFERS[playerProviderId] ?? [];
  }

  async getFixtureStatistics(fixtureProviderId: string): Promise<NormalizedFixtureStatistics | null> {
    return fixtureProviderId === MOCK_STATISTICS.fixtureProviderId ? MOCK_STATISTICS : null;
  }

  /**
   * Per-player match statistics for the one mock fixture. Deliberately carries
   * NO coordinates, exactly like the real provider — the mock's job is to let
   * UI be built without spending quota, and a mock that quietly had a
   * capability the real provider lacks would let a surface be built that can
   * never work in production. That is the mistake this file's existing comments
   * (no market value, no date of birth, no photo) already guard against.
   */
  async getFixturePlayerStatistics(fixtureProviderId: string): Promise<NormalizedFixturePlayerStatistics | null> {
    return fixtureProviderId === MOCK_FIXTURE_PLAYER_STATS.fixtureProviderId ? MOCK_FIXTURE_PLAYER_STATS : null;
  }

  async getCompetitionCoverage(season: number): Promise<NormalizedCompetitionCoverage[]> {
    return MOCK_COVERAGE.map((row) => ({ ...row, season }));
  }

  /** Empty, always. There is no mock injury list: an invented injury is a
   * claim about a named player's body, and the mock's fake names sit in the
   * same UI components real ones would. */
  async getInjuries(): Promise<NormalizedInjury[]> {
    return [];
  }

  async getTopScorers(): Promise<NormalizedTopScorer[]> {
    return MOCK_TOP_SCORERS;
  }

  async getPlayerSeasonStatistics(
    playerProviderId: string,
    season: number,
  ): Promise<NormalizedPlayerSeasonStatistics[]> {
    const rows = MOCK_PLAYER_SEASON_STATS[playerProviderId];
    return rows ? rows.map((row) => ({ ...row, season })) : [];
  }
}
