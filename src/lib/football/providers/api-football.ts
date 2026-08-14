import "server-only";
import type { FixtureStatus, FootballDataProvider, NormalizedFixture, NormalizedStandingRow } from "../types";

const BASE_URL = "https://v3.football.api-sports.io";

/** Free-tier friendly cache window — avoid re-fetching the same day's fixtures repeatedly. */
const FIXTURE_CACHE_SECONDS = 300;

function mapStatus(shortStatus: string): FixtureStatus {
  if (["1H", "2H", "ET", "P", "LIVE"].includes(shortStatus)) return "live";
  if (shortStatus === "HT") return "halftime";
  if (["FT", "AET", "PEN"].includes(shortStatus)) return "finished";
  if (shortStatus === "PST") return "postponed";
  if (["CANC", "ABD", "AWD", "WO"].includes(shortStatus)) return "cancelled";
  if (shortStatus === "NS") return "scheduled";
  return "unknown";
}

interface ApiFootballFixtureResponse {
  response: Array<{
    fixture: {
      id: number;
      date: string;
      status: { short: string; elapsed: number | null };
      venue: { name: string | null };
    };
    league: { name: string; season: number };
    teams: {
      home: { id: number; name: string; logo: string | null };
      away: { id: number; name: string; logo: string | null };
    };
    goals: { home: number | null; away: number | null };
  }>;
}

/**
 * API-Football adapter — the free tier is the only tier this is built against for now
 * (see DECISIONS.md). Every call is cache-first; nothing here polls on its own, and
 * live polling stays behind the FOOTBALL_LIVE_POLLING_ENABLED flag until real quota exists.
 */
export class ApiFootballProvider implements FootballDataProvider {
  readonly name = "api-football";

  constructor(private readonly apiKey: string) {}

  private async request<T>(path: string, revalidateSeconds: number): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "x-apisports-key": this.apiKey },
      next: { revalidate: revalidateSeconds },
    });

    if (!res.ok) {
      throw new Error(`API-Football request failed (${res.status}): ${path}`);
    }

    return res.json() as Promise<T>;
  }

  async getFixturesByDate(date: string): Promise<NormalizedFixture[]> {
    const data = await this.request<ApiFootballFixtureResponse>(`/fixtures?date=${date}`, FIXTURE_CACHE_SECONDS);
    const retrievedAt = new Date().toISOString();

    return data.response.map((item) => ({
      provider: this.name,
      providerId: String(item.fixture.id),
      competitionName: item.league.name,
      season: item.league.season,
      kickoffAt: item.fixture.date,
      status: mapStatus(item.fixture.status.short),
      minute: item.fixture.status.elapsed,
      homeTeam: {
        providerId: String(item.teams.home.id),
        name: item.teams.home.name,
        shortName: null,
        crestUrl: item.teams.home.logo,
      },
      awayTeam: {
        providerId: String(item.teams.away.id),
        name: item.teams.away.name,
        shortName: null,
        crestUrl: item.teams.away.logo,
      },
      homeScore: item.goals.home,
      awayScore: item.goals.away,
      venueName: item.fixture.venue.name,
      retrievedAt,
    }));
  }

  async getFixtureById(providerId: string): Promise<NormalizedFixture | null> {
    const data = await this.request<ApiFootballFixtureResponse>(`/fixtures?id=${providerId}`, FIXTURE_CACHE_SECONDS);
    const retrievedAt = new Date().toISOString();
    const item = data.response[0];
    if (!item) return null;

    return {
      provider: this.name,
      providerId: String(item.fixture.id),
      competitionName: item.league.name,
      season: item.league.season,
      kickoffAt: item.fixture.date,
      status: mapStatus(item.fixture.status.short),
      minute: item.fixture.status.elapsed,
      homeTeam: {
        providerId: String(item.teams.home.id),
        name: item.teams.home.name,
        shortName: null,
        crestUrl: item.teams.home.logo,
      },
      awayTeam: {
        providerId: String(item.teams.away.id),
        name: item.teams.away.name,
        shortName: null,
        crestUrl: item.teams.away.logo,
      },
      homeScore: item.goals.home,
      awayScore: item.goals.away,
      venueName: item.fixture.venue.name,
      retrievedAt,
    };
  }

  async getStandings(): Promise<NormalizedStandingRow[]> {
    // Deferred until a concrete Standings surface is built — the interface exists now so
    // the frontend/database never has to change shape when this is implemented.
    return [];
  }
}
