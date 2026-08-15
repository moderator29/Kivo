import "server-only";
import type {
  FootballDataProvider,
  NormalizedFixture,
  NormalizedLineups,
  NormalizedManager,
  NormalizedMatchEvent,
  NormalizedPlayer,
  NormalizedStandingRow,
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
    homeTeam: { providerId: "mock-team-1", name: "Remo Stars", shortName: "REM", crestUrl: null },
    awayTeam: { providerId: "mock-team-2", name: "Enyimba", shortName: "ENY", crestUrl: null },
    homeScore: null,
    awayScore: null,
    venueProviderId: "mock-venue-1",
    venueName: "Remo Stars Stadium",
    retrievedAt: new Date().toISOString(),
  },
];

/** Deliberately mirrors the real provider's limitation: no dateOfBirth/nationality
 * from a squads-style listing — see the doc comment on getSquad() in api-football.ts. */
const MOCK_SQUADS: Record<string, NormalizedPlayer[]> = {
  "mock-team-1": [
    { providerId: "mock-player-1", fullName: "Chidi Okafor", knownAs: null, dateOfBirth: null, nationality: null, position: "Goalkeeper" },
    { providerId: "mock-player-2", fullName: "Tunde Bakare", knownAs: null, dateOfBirth: null, nationality: null, position: "Defender" },
    { providerId: "mock-player-3", fullName: "Femi Adisa", knownAs: null, dateOfBirth: null, nationality: null, position: "Midfielder" },
    { providerId: "mock-player-4", fullName: "Kelechi Uzo", knownAs: "K. Uzo", dateOfBirth: null, nationality: null, position: "Attacker" },
  ],
  "mock-team-2": [
    { providerId: "mock-player-5", fullName: "Emeka Nwosu", knownAs: null, dateOfBirth: null, nationality: null, position: "Goalkeeper" },
    { providerId: "mock-player-6", fullName: "Yusuf Danladi", knownAs: null, dateOfBirth: null, nationality: null, position: "Defender" },
    { providerId: "mock-player-7", fullName: "Obinna Chukwu", knownAs: null, dateOfBirth: null, nationality: null, position: "Midfielder" },
    { providerId: "mock-player-8", fullName: "Ahmed Musa Jr", knownAs: null, dateOfBirth: null, nationality: null, position: "Attacker" },
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
      entries: [
        { playerProviderId: "mock-player-1", playerName: "Chidi Okafor", isStarting: true, shirtNumber: 1, position: "G" },
        { playerProviderId: "mock-player-2", playerName: "Tunde Bakare", isStarting: true, shirtNumber: 4, position: "D" },
        { playerProviderId: "mock-player-3", playerName: "Femi Adisa", isStarting: true, shirtNumber: 8, position: "M" },
        { playerProviderId: "mock-player-4", playerName: "Kelechi Uzo", isStarting: false, shirtNumber: 11, position: "F" },
      ],
    },
    {
      team: { providerId: "mock-team-2", name: "Enyimba", shortName: "ENY", crestUrl: null },
      entries: [
        { playerProviderId: "mock-player-5", playerName: "Emeka Nwosu", isStarting: true, shirtNumber: 1, position: "G" },
        { playerProviderId: "mock-player-6", playerName: "Yusuf Danladi", isStarting: true, shirtNumber: 5, position: "D" },
        { playerProviderId: "mock-player-7", playerName: "Obinna Chukwu", isStarting: true, shirtNumber: 6, position: "M" },
        { playerProviderId: "mock-player-8", playerName: "Ahmed Musa Jr", isStarting: false, shirtNumber: 9, position: "F" },
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

export class MockFootballProvider implements FootballDataProvider {
  readonly name = "mock";

  async getFixturesByDate(): Promise<NormalizedFixture[]> {
    return MOCK_FIXTURES;
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
}
