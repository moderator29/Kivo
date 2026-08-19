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
  /** Round/gameweek number within the competition, mirroring `fixtures.matchday`
   * (migration 0001). Null is a real answer and a common one: a cup
   * quarter-final does not belong to a numbered matchday, and numbering
   * knockout rounds would fabricate an ordering the competition does not have.
   * Derived by `parseMatchday` (./matchday.ts) from whatever round label the
   * provider reports — see that module for why "Round of 16" is null and not 16. */
  matchday: number | null;
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
  /** Provider-hosted headshot URL, mirrors players.photo_url (migration 0030,
   * RECOMMENDATIONS.md item 56) — real provider data already fetched by
   * getSquad(), not a KIVO-hosted asset. Null when the provider has none on
   * file, never a placeholder image URL. */
  photoUrl: string | null;
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
  /** The provider's own formation slot for this player, as a raw "row:col"
   * string (API-Football reports e.g. "1:1" for the goalkeeper, "2:4" for the
   * right-most player in the second line). Null for every substitute, and null
   * whenever the provider omits it.
   *
   * This is the only genuinely *positional* field API-Football publishes, and
   * it arrives free on a request KIVO already makes — the same reasoning that
   * put `photoUrl` on NormalizedPlayer. It is a formation slot, NOT tracking
   * data: it says where a player lined up, never where they went. Everything
   * downstream that consumes it (see `src/lib/football/heatmap/`) is required
   * to label what it produces as derived rather than observed.
   *
   * Deliberately kept as the provider's raw string rather than parsed here:
   * the row/column semantics are a provider quirk, so parsing belongs in the
   * normalizer that owns that quirk (`parsePitchGrid` in
   * providers/normalizers.ts), not in the shared type. */
  grid: string | null;
}

export interface NormalizedTeamLineup {
  team: NormalizedTeam;
  entries: NormalizedLineupEntry[];
  /** e.g. "4-3-3" — null when the provider hasn't published a formation yet
   * for this fixture (common before lineups are officially confirmed). */
  formation: string | null;
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

/**
 * One player's own statistics for one fixture, as reported by a per-fixture
 * player-statistics endpoint (API-Football: `/fixtures/players?fixture={id}`).
 *
 * Every numeric field is `number | null`, and null means "the provider did not
 * report this", never zero. That distinction carries real weight here: a
 * midfielder with `tacklesTotal: null` is a midfielder KIVO knows nothing about,
 * and one with `tacklesTotal: 0` made no tackles. Anything derived from these
 * numbers has to be able to tell those apart, or it will present ignorance as a
 * fact about the player.
 *
 * **There are no coordinates on this type, because the provider publishes
 * none.** These are counts of things a player did, not places they did them.
 * See `docs/HEATMAP_ENGINE.md` for what may and may not be built on top of that.
 */
export interface NormalizedPlayerFixtureStatistics {
  playerProviderId: string;
  playerName: string;
  teamProviderId: string;
  /** Minutes actually played. Null when unreported; 0 is a real answer for an
   * unused substitute. */
  minutesPlayed: number | null;
  /** The provider's coarse position code for how this player was deployed in
   * this match (API-Football uses single letters: G, D, M, F). Free text on
   * purpose, same convention as NormalizedPlayer.position. */
  position: string | null;
  /** True when the player came off the bench, false when they started, null
   * when the provider does not say. */
  isSubstitute: boolean | null;
  /** The provider's own match rating (API-Football reports a 0-10 string).
   * KIVO's `rating-engine.ts` computes its own separate rating and the two are
   * never mixed — this is the provider's opinion, stored as the provider's. */
  providerRating: number | null;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  goals: number | null;
  assists: number | null;
  goalsConceded: number | null;
  saves: number | null;
  passesTotal: number | null;
  passesKey: number | null;
  passAccuracy: number | null;
  tacklesTotal: number | null;
  blocks: number | null;
  interceptions: number | null;
  duelsTotal: number | null;
  duelsWon: number | null;
  dribblesAttempted: number | null;
  dribblesSucceeded: number | null;
  dribbledPast: number | null;
  foulsDrawn: number | null;
  foulsCommitted: number | null;
  yellowCards: number | null;
  redCards: number | null;
  offsides: number | null;
  penaltiesWon: number | null;
  penaltiesCommitted: number | null;
  penaltiesScored: number | null;
  penaltiesMissed: number | null;
  penaltiesSaved: number | null;
}

/** One fixture's per-player statistics for both sides. Null (not an empty
 * array) from a provider that has nothing published for this fixture, same
 * "nothing yet" convention as getLineups/getFixtureStatistics. */
export interface NormalizedFixturePlayerStatistics {
  fixtureProviderId: string;
  players: NormalizedPlayerFixtureStatistics[];
}

/**
 * What a provider says it supports for one competition in one season.
 *
 * This is the provider's own declaration, read from its leagues endpoint — not
 * KIVO's inference from empty tables, and not a hand-maintained list. That is
 * the entire point of the coverage registry: "this competition structurally
 * cannot fill this tab" and "nobody has synced this tab yet" are different
 * facts, and only the provider can tell KIVO the first one.
 *
 * Every flag is `boolean | null`. Null means the provider did not state a
 * position on this capability, which is genuinely different from stating
 * `false` — a null must render as "unknown", never as "unsupported".
 */
export interface NormalizedCompetitionCoverage {
  competitionProviderId: string;
  competitionName: string;
  /** The provider's own season identifier — API-Football uses the starting
   * year as an integer (2025 for the 2025/26 season). */
  season: number;
  fixtureEvents: boolean | null;
  fixtureLineups: boolean | null;
  fixtureStatistics: boolean | null;
  /** Per-PLAYER per-fixture statistics — the flag that decides whether a
   * heatmap has any event basis at all for this competition. */
  fixturePlayerStatistics: boolean | null;
  standings: boolean | null;
  players: boolean | null;
  topScorers: boolean | null;
  topAssists: boolean | null;
  topCards: boolean | null;
  injuries: boolean | null;
  predictions: boolean | null;
  odds: boolean | null;
  /** The raw coverage object exactly as the provider sent it, so a capability
   * KIVO has not modelled yet is preserved rather than silently discarded, and
   * so a future reader can check KIVO's mapping against the source. */
  raw: unknown;
}

/** Whether a player is out or a doubt, as the provider classifies it. "unknown"
 * exists for the same reason every other enum here has one: an unmapped
 * provider string must say so rather than be filed under a status KIVO made up. */
export type NormalizedInjuryStatus = "out" | "doubtful" | "unknown";

export interface NormalizedInjury {
  /** Synthetic composite key — the injuries endpoint publishes no stable per-row
   * id, same situation as events and transfers. */
  providerId: string;
  playerProviderId: string;
  playerName: string;
  teamProviderId: string | null;
  /** The fixture the provider attached this report to, when it attached one. */
  fixtureProviderId: string | null;
  status: NormalizedInjuryStatus;
  /** The provider's own free-text reason ("Knee Injury", "Suspended"), stored
   * verbatim rather than bucketed — bucketing a medical description is exactly
   * the kind of inference this codebase does not do. */
  reason: string | null;
  /** ISO date the report applies to, when the provider dates it. */
  reportedOn: string | null;
}

/** One entry in a competition's scoring charts. Ranked by the provider itself;
 * KIVO stores the provider's order rather than re-sorting, so ties break the
 * way the competition breaks them rather than the way JavaScript does. */
export interface NormalizedTopScorer {
  rank: number;
  playerProviderId: string;
  playerName: string;
  playerPhotoUrl: string | null;
  teamProviderId: string | null;
  teamName: string | null;
  goals: number | null;
  assists: number | null;
  penaltiesScored: number | null;
  appearances: number | null;
  minutesPlayed: number | null;
}

/**
 * One player's aggregate statistics for one competition in one season.
 *
 * A player who appeared in a league and a cup has one of these per
 * competition, which is what makes competition splits and a career breakdown
 * possible at all. Same null-means-unreported rule as
 * NormalizedPlayerFixtureStatistics.
 */
export interface NormalizedPlayerSeasonStatistics {
  playerProviderId: string;
  playerName: string;
  competitionProviderId: string;
  competitionName: string | null;
  season: number;
  teamProviderId: string | null;
  teamName: string | null;
  position: string | null;
  appearances: number | null;
  lineups: number | null;
  minutesPlayed: number | null;
  providerRating: number | null;
  goals: number | null;
  assists: number | null;
  goalsConceded: number | null;
  saves: number | null;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  passesTotal: number | null;
  passesKey: number | null;
  passAccuracy: number | null;
  tacklesTotal: number | null;
  blocks: number | null;
  interceptions: number | null;
  duelsTotal: number | null;
  duelsWon: number | null;
  dribblesAttempted: number | null;
  dribblesSucceeded: number | null;
  foulsDrawn: number | null;
  foulsCommitted: number | null;
  yellowCards: number | null;
  redCards: number | null;
  penaltiesScored: number | null;
  penaltiesMissed: number | null;
}

export interface FootballDataProvider {
  readonly name: string;
  /** Most recent remaining-quota count the provider itself reported, or null if
   * no request has completed yet (or the provider doesn't report one at all —
   * see MockFootballProvider). Real provider data, not an estimate
   * (RECOMMENDATIONS.md item 53). */
  getQuotaRemaining(): number | null;
  /** RECOMMENDATIONS.md item 65: a bounded sample of the last raw response
   * (success or failure) this provider instance actually received — see
   * `raw-response-sample.ts`. Null until at least one request has completed,
   * or always null for a provider with no real upstream to sample (see
   * MockFootballProvider), same honesty convention as getQuotaRemaining. */
  getLastRawResponseSample(): unknown | null;
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
  /**
   * Per-player statistics for one fixture. Null when the provider has nothing
   * published for this fixture — which on a restricted plan or an uncovered
   * competition is the permanent answer, not a temporary one. Ask the coverage
   * registry (`getCompetitionCoverage` below) before spending a request on
   * this: it is the difference between "not yet" and "never".
   */
  getFixturePlayerStatistics(fixtureProviderId: string): Promise<NormalizedFixturePlayerStatistics | null>;
  /**
   * What this provider declares it supports, per competition, for one season.
   * Empty array when the provider publishes no such declaration — an empty
   * result means KIVO knows nothing about coverage, and every consumer must
   * treat that as "unknown", never as "unsupported".
   */
  getCompetitionCoverage(season: number): Promise<NormalizedCompetitionCoverage[]>;
  /** Current injury/unavailability reports for one competition and season. */
  getInjuries(competitionProviderId: string, season: number): Promise<NormalizedInjury[]>;
  /** The competition's scoring chart, in the provider's own ranked order. */
  getTopScorers(competitionProviderId: string, season: number): Promise<NormalizedTopScorer[]>;
  /**
   * One player's season aggregates, one entry per competition they appeared in
   * that season. Empty array when the provider has nothing for this player.
   */
  getPlayerSeasonStatistics(playerProviderId: string, season: number): Promise<NormalizedPlayerSeasonStatistics[]>;
}
