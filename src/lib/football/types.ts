// Lines up 1:1 with the `fixture_status` Postgres enum (supabase/migrations/0001,
// 0017) — provider status codes that don't map cleanly to a known value land on
// "unknown" here, which is itself a real enum value rather than an app-layer-only
// placeholder.
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
  /** Half-time score, mirrors fixtures.home_score_ht/away_score_ht — null until
   * half-time has actually happened for this fixture (pre-kickoff, or a fixture
   * that never reached HT), same "not reported yet" convention as homeScore/
   * awayScore pre-kickoff. Never estimated from the full-time score. */
  homeScoreHt: number | null;
  awayScoreHt: number | null;
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
// except for "unknown" — unlike FixtureStatus, this enum has no DB-side "unknown"
// slot, so a provider type/detail combination that doesn't map cleanly lands here
// and the sync pipeline skips (never fabricates) rather than writing a bad enum value.
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

export interface NormalizedFixtureTeamStatistics {
  team: NormalizedTeam;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  shotsOffTarget: number | null;
  shotsBlocked: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  fouls: number | null;
  corners: number | null;
  offsides: number | null;
  possessionPct: number | null;
  yellowCards: number | null;
  redCards: number | null;
  saves: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  passesPct: number | null;
  /** Only some competitions/providers report xG — stays null rather than 0 when
   * unknown, mirrors fixture_statistics.expected_goals in the schema. */
  expectedGoals: number | null;
}

/** One fixture's team statistics — one entry per side (normally exactly two),
 * same "one entry per side" shape as NormalizedLineups. */
export interface NormalizedFixtureStatistics {
  fixtureProviderId: string;
  teams: NormalizedFixtureTeamStatistics[];
}

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

// Must line up with the `transfer_type` Postgres enum (supabase/migrations/0006_transfers)
// — "unknown" is used whenever the provider's raw fee text doesn't map cleanly onto one
// of the other buckets. The sync pipeline writes exactly this inferred value, never a guess.
export type NormalizedTransferType = "transfer" | "loan" | "free" | "end_of_loan" | "unknown";

export interface NormalizedTransfer {
  /** Synthetic composite id — API-Football's /transfers response has no stable per-move
   * id, so the provider derives a deterministic key (player + date + teams) that stays
   * stable across re-fetches. Deduped through provider_mappings under entity_type
   * 'transfer', same pattern as fixture_event's synthetic id. */
  providerId: string;
  playerProviderId: string;
  /** Null when the provider doesn't report a stable team id for this side of the move
   * (e.g. a club outside its coverage) — the sync pipeline leaves the FK null rather
   * than dedupe-by-name, same rationale as NormalizedFixture.venueProviderId. */
  fromTeamProviderId: string | null;
  fromTeamName: string | null;
  toTeamProviderId: string | null;
  toTeamName: string | null;
  transferDate: string;
  /** Raw provider string — e.g. "€45M", "Free", "Loan", "N/A" — stored verbatim
   * (see transfers.fee_text doc comment in the migration) rather than parsed into a number. */
  feeText: string | null;
  /** Inferred from feeText at the normalization layer so every provider implementation
   * (including mock) produces this consistently; sync-transfers.ts writes it as-is. */
  transferType: NormalizedTransferType;
}

export interface FootballDataProvider {
  readonly name: string;
  /** Most recent remaining-quota count the provider itself reported, or null if
   * no request has completed yet (or the provider doesn't report one at all —
   * see MockFootballProvider). Real provider data, not an estimate
   * (RECOMMENDATIONS.md item 53). */
  getQuotaRemaining(): number | null;
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
  /** Null when the provider has no statistics published yet for this fixture
   * (common before kickoff, or on a competition tier that doesn't report them). */
  getFixtureStatistics(fixtureProviderId: string): Promise<NormalizedFixtureStatistics | null>;
  /** Full recorded transfer history for one player — real, already-happened moves only
   * (see AGENTS.md: no rumour/reported tier exists on the free tier). Newest-first is
   * not guaranteed by the provider; sync-transfers.ts does not assume an order. */
  getPlayerTransfers(playerProviderId: string): Promise<NormalizedTransfer[]>;
}
