export type FixtureStatus =
  | "scheduled"
  | "live"
  | "halftime"
  | "finished"
  | "postponed"
  | "cancelled"
  | "unknown";

export interface NormalizedTeam {
  /** KIVO-internal identity is not assigned yet at the provider layer — this is the provider's own id. */
  providerId: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
}

export interface NormalizedFixture {
  provider: string;
  providerId: string;
  competitionName: string;
  season: number;
  kickoffAt: string;
  status: FixtureStatus;
  minute: number | null;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  homeScore: number | null;
  awayScore: number | null;
  venueName: string | null;
  /** When this record was fetched from the provider — required for freshness display, never omit. */
  retrievedAt: string;
}

export interface NormalizedStandingRow {
  provider: string;
  team: NormalizedTeam;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface FootballDataProvider {
  readonly name: string;
  getFixturesByDate(date: string): Promise<NormalizedFixture[]>;
  getFixtureById(providerId: string): Promise<NormalizedFixture | null>;
  getStandings(leagueProviderId: string, season: number): Promise<NormalizedStandingRow[]>;
}
