import "server-only";
import type { FootballDataProvider, NormalizedFixture, NormalizedStandingRow } from "../types";

/**
 * Development-only fixture data so UI can be built without spending API-Football's
 * free-tier quota. Never reachable in production — see the guard in ../index.ts.
 */
const MOCK_FIXTURES: NormalizedFixture[] = [
  {
    provider: "mock",
    providerId: "mock-1",
    competitionName: "Nigeria Premier Football League",
    season: 2026,
    kickoffAt: new Date().toISOString(),
    status: "scheduled",
    minute: null,
    homeTeam: { providerId: "mock-team-1", name: "Remo Stars", shortName: "REM", crestUrl: null },
    awayTeam: { providerId: "mock-team-2", name: "Enyimba", shortName: "ENY", crestUrl: null },
    homeScore: null,
    awayScore: null,
    venueName: "Remo Stars Stadium",
    retrievedAt: new Date().toISOString(),
  },
];

export class MockFootballProvider implements FootballDataProvider {
  readonly name = "mock";

  async getFixturesByDate(): Promise<NormalizedFixture[]> {
    return MOCK_FIXTURES;
  }

  async getFixtureById(providerId: string): Promise<NormalizedFixture | null> {
    return MOCK_FIXTURES.find((f) => f.providerId === providerId) ?? null;
  }

  async getStandings(): Promise<NormalizedStandingRow[]> {
    return [];
  }
}
