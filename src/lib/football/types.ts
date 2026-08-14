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

export interface NormalizedPlayer {
  providerId: string;
  fullName: string;
  knownAs: string | null;
  /** ISO date (YYYY-MM-DD) when the provider actually reports one — see the
   * getSquad() doc comment in providers/api-football.ts for why the free-tier
   * squads endpoint usually can't supply this (and why it's left null rather
   * than derived/estimated from an "age" field). */
  dateOfBirth: string | null;
  nationality: string | null;
  /** Free text on purpose, mirrors players.position in the schema — providers
   * report coarse buckets (e.g. "Goalkeeper") rather than a fixed taxonomy. */
  position: string | null;
}

export interface NormalizedManager {
  providerId: string;
  fullName: string;
  nationality: string | null;
  dateOfBirth: string | null;
}

export interface NormalizedLineupEntry {
  playerProviderId: string;
  /** Kept for logging when the player can't be resolved to a KIVO id yet. */
  playerName: string;
  isStarting: boolean;
  shirtNumber: number | null;
  position: string | null;
}

export interface NormalizedTeamLineup {
  team: NormalizedTeam;
  entries: NormalizedLineupEntry[];
}

/** One fixture's lineups — one entry per side (normally exactly two). */
export interface NormalizedLineups {
  fixtureProviderId: string;
  teams: NormalizedTeamLineup[];
}

// Must line up with the `fixture_event_type` Postgres enum (supabase/migrations/0001)
// except for "unknown", the same normalization-layer pattern as FixtureStatus above —
// a provider type/detail combination that doesn't map cleanly lands here, and the
// sync pipeline skips (never fabricates) rather than writing a bad enum value.
export type NormalizedMatchEventType =
  | "goal"
  | "own_goal"
  | "penalty_goal"
  | "penalty_missed"
  | "yellow_card"
  | "second_yellow_card"
  | "red_card"
  | "substitution"
  | "var_review"
  | "unknown";

export interface NormalizedMatchEvent {
  /** Synthetic composite id — API-Football's /fixtures/events response has no
   * stable per-event id, so the provider derives a deterministic key (fixture +
   * team + player + minute + type + detail) that stays stable across re-fetches
   * of the same event. This is what gets deduped through provider_mappings under
   * entity_type 'fixture_event', same as any other provider-mapped entity. */
  providerId: string;
  teamProviderId: string;
  playerProviderId: string | null;
  playerName: string | null;
  relatedPlayerProviderId: string | null;
  relatedPlayerName: string | null;
  eventType: NormalizedMatchEventType;
  minute: number;
  addedTime: number | null;
  detail: string | null;
}

export interface FootballDataProvider {
  readonly name: string;
  getFixturesByDate(date: string): Promise<NormalizedFixture[]>;
  getFixtureById(providerId: string): Promise<NormalizedFixture | null>;
  getStandings(leagueProviderId: string, season: number): Promise<NormalizedStandingRow[]>;
  /** Full current squad for a team. See provider doc comments for exactly which
   * fields the free tier returns — notably: no market value, ever (see AGENTS.md). */
  getSquad(teamProviderId: string): Promise<NormalizedPlayer[]>;
  /** Current first-team manager/head coach, or null if the provider has none on file. */
  getManager(teamProviderId: string): Promise<NormalizedManager | null>;
  /** Null when the provider has no lineups published yet for this fixture. */
  getLineups(fixtureProviderId: string): Promise<NormalizedLineups | null>;
  getMatchEvents(fixtureProviderId: string): Promise<NormalizedMatchEvent[]>;
}
