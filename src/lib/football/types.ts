// Must line up with the `fixture_status` Postgres enum (supabase/migrations/0001) except
// for "unknown", which exists only at this normalization layer — provider status codes
// that don't map cleanly to a DB value land here, and the sync pipeline is responsible
// for translating "unknown" into a safe DB-enum value before writing (see sync.ts).
export type FixtureStatus =
  | "scheduled"
  | "live"
  | "halftime"
  | "finished"
  | "postponed"
  | "cancelled"
  | "abandoned"
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
  /** Provider's own id for the competition/league — required so the sync pipeline can
   * dedupe competitions via provider_mappings instead of matching on name. */
  competitionProviderId: string;
  competitionName: string;
  season: number;
  kickoffAt: string;
  status: FixtureStatus;
  minute: number | null;
  homeTeam: NormalizedTeam;
  awayTeam: NormalizedTeam;
  homeScore: number | null;
  awayScore: number | null;
  /** Null when the provider doesn't report a stable venue id for this fixture — the sync
   * pipeline leaves fixtures.venue_id null in that case rather than dedupe-by-name. */
  venueProviderId: string | null;
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
