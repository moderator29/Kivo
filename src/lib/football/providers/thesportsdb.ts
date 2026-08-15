import "server-only";
import type {
  FootballDataProvider,
  NormalizedFixture,
  NormalizedFixtureStatistics,
  NormalizedLineups,
  NormalizedManager,
  NormalizedMatchEvent,
  NormalizedPlayer,
  NormalizedStandingRow,
  NormalizedTransfer,
} from "../types";
import { TheSportsDbError, requestWithRetry } from "./thesportsdb-request";
import { mapEvent, toIntOrZero, toTheSportsDbSeasonString, type TheSportsDbEvent } from "./thesportsdb-normalizers";
import { buildRawResponseSample, type RawResponseSample } from "../raw-response-sample";

/**
 * TheSportsDB v1 adapter — a second, config-selectable `FootballDataProvider`
 * implementation alongside ApiFootballProvider (see ../index.ts's
 * getFootballDataProvider(), selected via FOOTBALL_DATA_PROVIDER=thesportsdb).
 * API-Football stays the default/primary provider per the founder's own
 * standing directive; this is additive, not a replacement.
 *
 * ---- Sourcing note (read before trusting a field name here) ----
 * This sandbox's outbound network access to thesportsdb.com itself is
 * blocked (the same class of egress restriction that blocked
 * docs.sportmonks.com during the now-removed premium-stats.ts research pass
 * — see DECISIONS.md), so the endpoint catalog, parameters, and field names
 * below were NOT read directly off thesportsdb.com/documentation. They were
 * cross-referenced across several independent, mutually-consistent public
 * sources instead: TheSportsDB's own endpoint list as encoded in the
 * long-standing open-source `TralahM/thesportsdb` Python client's
 * settings.py (a 1:1 mirror of the official endpoint catalog, not a
 * reimplementation), community documentation threads, and search-indexed
 * excerpts of TheSportsDB's own docs pages. Where multiple sources agreed
 * (endpoint paths, query parameter names, the str/int-prefixed field-naming
 * convention used consistently across the whole API), confidence is high.
 * Where they didn't, or where no source could confirm a shape at all
 * (per-fixture stats, lineups, event timelines, a "current manager" entity,
 * transfer history), this adapter throws a clear "not supported by this
 * provider" error instead of guessing — see each method below.
 *
 * ---- Auth ----
 * v1 auth is a plain API key embedded as a URL path segment
 * (`/api/v1/json/{key}/endpoint.php`), not a header — unlike API-Football's
 * `x-apisports-key` header. There is a widely-documented free public test key
 * ("123") that TheSportsDB's own examples use, but this adapter never
 * hardcodes it — THE_SPORTS_DB_API_KEY must be set. v2
 * (`/api/v2/json`, `X-API-KEY` header) is real but Patreon/premium-only per
 * every source checked; this adapter targets v1 only.
 *
 * ---- Free-tier limitations (confirmed by cross-referenced community
 * sources, not by a live call from this sandbox) ----
 * - ~30 requests/minute rate limit (vs. 100-120/min on paid Patreon tiers).
 * - `lookuptable.php` (standings) is documented as restricted to a set of
 *   "featured" soccer leagues on the free tier — a league outside that set
 *   may return an empty table even though the league itself exists in
 *   TheSportsDB. This adapter has no way to know that set in advance, so
 *   getStandings() below returns an honest empty array in that case rather
 *   than guessing which leagues are covered.
 * - Search endpoints (searchteams.php et al.) are reported as capped to a
 *   small number of results (as low as 1) on the free tier vs. much higher
 *   on Patreon tiers. Not used by this adapter's current method set, noted
 *   here for whoever extends it.
 * - No response header of any kind reports remaining quota (see
 *   ./thesportsdb-request.ts's top comment) — getQuotaRemaining() always
 *   returns null for this provider, honestly, not an estimate.
 * - No live match-minute or half-time-score field is confirmed present in
 *   the free-tier event schema (per-minute livescores are marketed as a
 *   Patreon perk) — both stay null, never guessed from status text.
 */

const BASE_URL = "https://www.thesportsdb.com/api/v1/json";

/** TheSportsDB's events endpoints are multi-sport — every request is scoped
 * to football/soccer explicitly rather than relying on a default. */
const SPORT = "Soccer";

/** Same reasoning as ApiFootballProvider's cache windows (see
 * providers/api-football.ts's top comment): chosen to make on-demand syncing
 * survive the documented ~30 requests/minute free-tier limit, not for
 * "freshness" on its own terms. */
const FIXTURE_CACHE_SECONDS = 300;
const SQUAD_CACHE_SECONDS = 86_400;
const STANDINGS_CACHE_SECONDS = 3_600;

interface TheSportsDbEventsResponse {
  events: TheSportsDbEvent[] | null;
}

interface TheSportsDbPlayer {
  idPlayer: string;
  strPlayer: string;
  dateBorn: string | null;
  strNationality: string | null;
  strPosition: string | null;
  strThumb: string | null;
  strCutout: string | null;
}

/** TheSportsDB is inconsistent about singular vs. plural root keys across
 * endpoints (documented elsewhere as a known API quirk, not this adapter's
 * assumption) — lookup_all_players.php is most commonly documented as
 * returning `player` (singular), so both are accepted defensively. */
interface TheSportsDbPlayersResponse {
  player?: TheSportsDbPlayer[] | null;
  players?: TheSportsDbPlayer[] | null;
}

interface TheSportsDbTableRow {
  idTeam: string;
  strTeam: string;
  strBadge: string | null;
  intRank: string | number;
  intPlayed: string | number;
  intWin: string | number;
  intDraw: string | number;
  intLoss: string | number;
  intGoalsFor: string | number;
  intGoalsAgainst: string | number;
  intPoints: string | number;
}

interface TheSportsDbTableResponse {
  table: TheSportsDbTableRow[] | null;
}

export class TheSportsDbProvider implements FootballDataProvider {
  readonly name = "thesportsdb";

  constructor(private readonly apiKey: string) {}

  /** TheSportsDB sends no quota/rate-limit header on any response (see this
   * file's top comment) — always null, honestly, never an estimate. */
  getQuotaRemaining(): number | null {
    return null;
  }

  /** RECOMMENDATIONS.md item 65 — see raw-response-sample.ts and this
   * provider's `status: null` caveat on the success path (thesportsdb-
   * request.ts's requestWithRetry returns only the parsed body, not the
   * Response, on success). */
  private lastRawResponseSample: RawResponseSample | null = null;

  getLastRawResponseSample(): RawResponseSample | null {
    return this.lastRawResponseSample;
  }

  private async request<T>(endpointPath: string, revalidateSeconds: number): Promise<T> {
    const url = `${BASE_URL}/${this.apiKey}${endpointPath}`;
    try {
      const json = await requestWithRetry<T>({
        path: endpointPath,
        url,
        fetchImpl: (input, init) => fetch(input, { ...init, next: { revalidate: revalidateSeconds } }),
      });
      this.lastRawResponseSample = buildRawResponseSample(endpointPath, null, json);
      return json;
    } catch (err) {
      if (err instanceof TheSportsDbError) {
        this.lastRawResponseSample = buildRawResponseSample(endpointPath, err.status, { error: err.message, kind: err.kind });
      }
      throw err;
    }
  }

  async getFixturesByDate(date: string): Promise<NormalizedFixture[]> {
    const data = await this.request<TheSportsDbEventsResponse>(
      `/eventsday.php?d=${date}&s=${SPORT}`,
      FIXTURE_CACHE_SECONDS,
    );
    return (data.events ?? []).map(mapEvent);
  }

  async getFixtureById(providerId: string): Promise<NormalizedFixture | null> {
    const data = await this.request<TheSportsDbEventsResponse>(`/lookupevent.php?id=${providerId}`, FIXTURE_CACHE_SECONDS);
    const item = data.events?.[0];
    return item ? mapEvent(item) : null;
  }

  /**
   * `lookuptable.php` — documented (by cross-referenced third-party sources,
   * not a live call) as restricted to a set of "featured" soccer leagues on
   * the free tier. A league outside that set is expected to come back with a
   * null/empty `table`, which this honestly reports as an empty array rather
   * than throwing — the same "nothing published yet" convention
   * ApiFootballProvider.getStandings() uses for a league with no table at
   * all, since this adapter can't distinguish "not a featured league" from
   * "no data yet" without a live response to check.
   */
  async getStandings(leagueProviderId: string, season: number): Promise<NormalizedStandingRow[]> {
    const seasonStr = toTheSportsDbSeasonString(season);
    const data = await this.request<TheSportsDbTableResponse>(
      `/lookuptable.php?l=${leagueProviderId}&s=${seasonStr}`,
      STANDINGS_CACHE_SECONDS,
    );
    return (data.table ?? []).map((row) => ({
      provider: this.name,
      team: {
        providerId: row.idTeam,
        name: row.strTeam,
        shortName: null,
        crestUrl: row.strBadge ?? null,
      },
      rank: toIntOrZero(row.intRank),
      played: toIntOrZero(row.intPlayed),
      won: toIntOrZero(row.intWin),
      drawn: toIntOrZero(row.intDraw),
      lost: toIntOrZero(row.intLoss),
      goalsFor: toIntOrZero(row.intGoalsFor),
      goalsAgainst: toIntOrZero(row.intGoalsAgainst),
      points: toIntOrZero(row.intPoints),
    }));
  }

  /**
   * `lookup_all_players.php?id={teamId}` — full current squad by team id.
   * Maps to NormalizedPlayer directly: dateOfBirth/nationality/position/photo
   * are all present in this endpoint's documented shape (unlike
   * API-Football's free-tier squads endpoint, which omits dateOfBirth/
   * nationality — see api-football.ts's getSquad() doc comment for that
   * contrast). `strCutout` (a background-removed player image, when present)
   * is preferred over `strThumb` for photoUrl since it's the more UI-ready
   * asset when TheSportsDB has one; falls back to strThumb, then null.
   */
  async getSquad(teamProviderId: string): Promise<NormalizedPlayer[]> {
    const data = await this.request<TheSportsDbPlayersResponse>(
      `/lookup_all_players.php?id=${teamProviderId}`,
      SQUAD_CACHE_SECONDS,
    );
    const players = data.player ?? data.players ?? [];
    return players.map((p) => ({
      providerId: p.idPlayer,
      fullName: p.strPlayer,
      knownAs: null,
      dateOfBirth: p.dateBorn,
      nationality: p.strNationality,
      position: p.strPosition,
      photoUrl: p.strCutout ?? p.strThumb ?? null,
    }));
  }

  /**
   * NOT SUPPORTED by this provider. TheSportsDB's v1 endpoint catalog (see
   * this file's top sourcing note) has no dedicated "current manager/coach"
   * lookup comparable to API-Football's `/coachs?team=`. Rather than guess at
   * an endpoint/shape with no source confirming one exists, this throws a
   * clear error — per the founder's directive: implement what's genuinely
   * supported, throw for the rest, never fabricate a gap-filler.
   */
  async getManager(): Promise<NormalizedManager | null> {
    throw new Error(
      "TheSportsDbProvider.getManager: not supported by this provider — TheSportsDB's v1 API has no confirmed dedicated current-manager/coach endpoint. Use ApiFootballProvider for manager data.",
    );
  }

  /**
   * NOT SUPPORTED by this provider. A `lookuplineup.php` endpoint exists in
   * TheSportsDB's catalog, but every source checked for this adapter
   * describes it as capped to a handful of free-tier calls with an unverified
   * response shape (see this file's top sourcing note) — not confident enough
   * to ship a normalizer against a guessed shape. Throws rather than risk
   * silently mis-mapping starting XI/substitute data.
   */
  async getLineups(): Promise<NormalizedLineups | null> {
    throw new Error(
      "TheSportsDbProvider.getLineups: not supported by this provider — TheSportsDB's free-tier lineup endpoint has no confirmed response shape available to this build. Use ApiFootballProvider for lineups.",
    );
  }

  /**
   * NOT SUPPORTED by this provider. A `lookuptimeline.php` endpoint exists in
   * TheSportsDB's catalog (goal/card/substitution timeline, by name), but no
   * source cross-checked for this adapter could confirm its free-tier
   * availability or exact field shape (event type vocabulary, minute field
   * name). Throws rather than guess at mapping onto NormalizedMatchEventType.
   */
  async getMatchEvents(): Promise<NormalizedMatchEvent[]> {
    throw new Error(
      "TheSportsDbProvider.getMatchEvents: not supported by this provider — TheSportsDB's match-event timeline has no confirmed response shape available to this build. Use ApiFootballProvider for match events.",
    );
  }

  /**
   * NOT SUPPORTED by this provider. A `lookupeventstats.php` endpoint exists
   * in TheSportsDB's catalog, but is reported by cross-referenced sources as
   * capped to a handful of free-tier calls with no confirmed field-name
   * mapping onto NormalizedFixtureTeamStatistics' fixed columns. Throws
   * rather than guess.
   */
  async getFixtureStatistics(): Promise<NormalizedFixtureStatistics | null> {
    throw new Error(
      "TheSportsDbProvider.getFixtureStatistics: not supported by this provider — no confirmed response shape available to this build. Use ApiFootballProvider for fixture statistics.",
    );
  }

  /**
   * NOT SUPPORTED by this provider. TheSportsDB's documented endpoint catalog
   * (see this file's top sourcing note) has no transfer-history endpoint at
   * all — it is simply not a data category TheSportsDB's public API covers,
   * confirmed vs. API-Football's genuine (if free-tier-limited) `/transfers`
   * endpoint. Throws rather than return an empty array that could be
   * misread as "this player has no transfer history" instead of "this
   * provider doesn't have this data category."
   */
  async getPlayerTransfers(): Promise<NormalizedTransfer[]> {
    throw new Error(
      "TheSportsDbProvider.getPlayerTransfers: not supported by this provider — TheSportsDB's public API has no transfer-history endpoint. Use ApiFootballProvider for transfer history.",
    );
  }
}

// Re-exported for callers that need to distinguish a TheSportsDB-specific
// failure (e.g. Data Health surfacing a provider-specific message) from a
// generic Error — mirrors ApiFootballError being exported from
// providers/api-football-request.ts.
export { TheSportsDbError };
