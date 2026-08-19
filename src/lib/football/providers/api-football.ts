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
  NormalizedProviderPlan,
  NormalizedPlayerSeasonStatistics,
  NormalizedStandingRow,
  NormalizedTeamProfile,
  NormalizedTopScorer,
  NormalizedTransfer,
  NormalizedTeamTransfer,
} from "../types";
import {
  mapEventType,
  mapFixtureStatistics,
  mapInjuryStatus,
  mapStatus,
  mapTransferType,
  parseCoverageFlag,
  parseProviderNumber,
} from "./normalizers";
import {
  extractProviderError,
  ApiFootballError,
  requestWithRetry,
  classifyProviderErrorKind,
  describePlanRefusal,
} from "./api-football-request";
import { buildRawResponseSample, type RawResponseSample } from "../raw-response-sample";
import { parseMatchday } from "../matchday";

const BASE_URL = "https://v3.football.api-sports.io";

/** Free-tier friendly cache window — avoid re-fetching the same day's fixtures repeatedly. */
const FIXTURE_CACHE_SECONDS = 300;
/** The live feed is the one endpoint whose entire value is being current, so it
 * gets the shortest window in this file. It is not what bounds how often the
 * endpoint is asked — the live worker's own derived pace is (see
 * `live-sync-planner.ts`); this only stops two callers in the same minute
 * paying twice for the same answer. */
const LIVE_FIXTURE_CACHE_SECONDS = 60;

// API-Football's free ("Free"/hobbyist) plan is 100 requests/day and 10 requests/minute
// (see api-football.com/pricing) — there is no other tier assumed anywhere in this file,
// per the project's $0 budget. Every window below is chosen to make on-demand, per-team/
// per-fixture syncing survive that quota rather than to serve "freshness" for its own sake.
/** A league's club list changes once a season, at most. A full day is already
 * far shorter than the thing it describes; longer would risk a newly promoted
 * club staying invisible for a week after the founder pressed the button. */
const TEAMS_CACHE_SECONDS = 86_400;
/** Squads/managers change rarely — cache a full day. */
const SQUAD_CACHE_SECONDS = 86_400;
const MANAGER_CACHE_SECONDS = 86_400;
/** Lineups/events/statistics can change during a live match — short cache, but never
 * zero, so a busy admin screen re-triggering a sync repeatedly can't hammer the daily
 * quota. */
const LINEUP_CACHE_SECONDS = 120;
const EVENTS_CACHE_SECONDS = 120;
const STATISTICS_CACHE_SECONDS = 120;
/** Standings settle slowly outside of matchdays — an hour is plenty fresh. */
const STANDINGS_CACHE_SECONDS = 3_600;
/** Per-player match statistics move on exactly the same clock as the team
 * statistics beside them — same window, deliberately, so a Match Centre that
 * refreshes one and not the other cannot show a player line that disagrees with
 * the team line above it. */
const FIXTURE_PLAYERS_CACHE_SECONDS = 120;
/** What a provider *supports* changes when a season rolls over, not during one.
 * A week is still a fraction of that, and this response is large (every league
 * the plan can see), so re-fetching it often is the most wasteful call available
 * on this API. */
const COVERAGE_CACHE_SECONDS = 604_800;
/** Injury reports are the one thing here that genuinely changes within a day —
 * a squad announcement can flip a player from doubt to available hours before
 * kickoff — but they are also never so urgent that a six-hour-old report misleads
 * anyone, and this is a per-competition call on a 100-request budget. */
const INJURIES_CACHE_SECONDS = 21_600;
/** A scoring chart only moves when matches are played. */
const TOP_SCORERS_CACHE_SECONDS = 21_600;
/** A player's season aggregate changes at most once per matchday. */
const PLAYER_SEASON_CACHE_SECONDS = 21_600;
/** Transfer history is append-only and barely changes day to day — cache well beyond
 * a single day so re-visiting a player's profile never burns fresh quota for data
 * that's already historical fact. */
const TRANSFERS_CACHE_SECONDS = 172_800;
/**
 * `/status` is the one endpoint whose answer changes on every other request
 * KIVO makes (it carries today's spend), so a long window would make it lie
 * about the number that matters most. Five minutes is short enough to be
 * useful on an admin screen somebody is actively watching and long enough that
 * refreshing that screen does not itself become the thing eating the quota.
 *
 * API-Football does not charge for `/status` against the daily allowance, but
 * this code does not take that on faith — it is cached like everything else.
 */
const STATUS_CACHE_SECONDS = 300;

interface ApiFootballSquadResponse {
  response: Array<{
    team: { id: number; name: string; logo: string | null };
    players: Array<{
      id: number;
      name: string;
      age: number | null;
      number: number | null;
      position: string | null;
      photo: string | null;
    }>;
  }>;
}

/**
 * `/teams?league={id}&season={year}`.
 *
 * One request, every club in the competition, each with the crest and the home
 * ground. This is the endpoint the club directory is built on — see
 * `getTeamsByLeague` below for why that matters.
 *
 * Every field is optional in this declaration even though the provider sends
 * most of them on most clubs, for the same reason the coverage response is
 * declared that way: a missing key must normalize to null, never to a crash or
 * to a fabricated value.
 */
interface ApiFootballTeamsResponse {
  response?: Array<{
    team?: {
      id?: number | null;
      name?: string | null;
      /** Three-letter club code ("MUN"). The provider's own abbreviation — used
       * as shortName rather than one KIVO derives by truncating the name. */
      code?: string | null;
      country?: string | null;
      founded?: number | null;
      /** True for national teams. Kept in the shape so a caller can see it
       * exists; KIVO does not currently model national sides separately. */
      national?: boolean | null;
      logo?: string | null;
    } | null;
    venue?: {
      id?: number | null;
      name?: string | null;
      city?: string | null;
    } | null;
  }> | null;
}

interface ApiFootballCoachResponse {
  response: Array<{
    id: number;
    name: string;
    firstname: string | null;
    lastname: string | null;
    birth: { date: string | null; place: string | null; country: string | null } | null;
    nationality: string | null;
  }>;
}

interface ApiFootballLineupsResponse {
  response: Array<{
    team: { id: number; name: string; logo: string | null };
    formation: string | null;
    // `grid` is present on startXI entries only — see NormalizedLineupEntry.grid.
    startXI: Array<{
      player: { id: number; name: string; number: number | null; pos: string | null; grid?: string | null };
    }>;
    substitutes: Array<{
      player: { id: number; name: string; number: number | null; pos: string | null; grid?: string | null };
    }>;
  }>;
}

interface ApiFootballEventsResponse {
  response: Array<{
    time: { elapsed: number; extra: number | null };
    team: { id: number; name: string };
    player: { id: number | null; name: string | null };
    assist: { id: number | null; name: string | null };
    type: string;
    detail: string;
  }>;
}

interface ApiFootballStatisticsResponse {
  response: Array<{
    team: { id: number; name: string; logo: string | null };
    statistics: Array<{ type: string; value: number | string | null }>;
  }>;
}

interface ApiFootballStandingsResponse {
  response: Array<{
    league: {
      id: number;
      season: number;
      // Array of groups (e.g. Champions League group stage) — a single-group league
      // (the common case) still comes back as one nested array.
      standings: Array<
        Array<{
          rank: number;
          team: { id: number; name: string; logo: string | null };
          points: number;
          // All three of these arrive on every /standings row and were
          // undeclared here, so getStandings never saw them and a league table
          // could not draw its qualification lines, split a group stage, or
          // show form. Same bug shape as the dropped referee, round label and
          // venue city: an adapter's response interface is not documentation,
          // it is a filter — anything it omits, the product cannot have.
          description?: string | null;
          group?: string | null;
          form?: string | null;
          all: {
            played: number;
            win: number;
            draw: number;
            lose: number;
            goals: { for: number; against: number };
          };
        }>
      >;
    };
  }>;
}

interface ApiFootballTransfersResponse {
  response: Array<{
    player: { id: number; name: string };
    update: string | null;
    transfers: Array<{
      date: string;
      type: string | null;
      teams: {
        in: { id: number | null; name: string | null; logo: string | null } | null;
        out: { id: number | null; name: string | null; logo: string | null } | null;
      };
    }>;
  }>;
}

interface ApiFootballFixtureResponse {
  response: Array<{
    fixture: {
      id: number;
      date: string;
      status: { short: string; elapsed: number | null };
      // `city` and `referee` are sent on every /fixtures item and were both
      // undeclared here, so both were dropped — which is why venues.city has
      // been null since migration 0001 and no match page could name the
      // official. Same payload, read more completely; costs nothing.
      venue: { id: number | null; name: string | null; city?: string | null };
      referee?: string | null;
    };
    // `round` is free text ("Regular Season - 12", "Quarter-finals"). KIVO
    // reads a matchday number out of it where there is one and stores null
    // where there is not — see parseMatchday in ../matchday.ts.
    // `country` is sent on every /fixtures item and was previously dropped on
    // the floor here, which is the whole reason competitions.country is null
    // for all 85 competitions in the live database. It is the provider's own
    // string ("England", "World" for continental competitions), not a code.
    league: { id: number; name: string; season: number; country?: string | null; round?: string | null };
    teams: {
      home: { id: number; name: string; logo: string | null };
      away: { id: number; name: string; logo: string | null };
    };
    goals: { home: number | null; away: number | null };
    // `score.halftime` is always present on a real /fixtures response (alongside
    // fulltime/extratime/penalty siblings, none of which KIVO models yet) — both
    // sides are null until half-time has actually happened for this fixture, the
    // same "not reported yet" convention as goals.home/away pre-kickoff.
    score: { halftime: { home: number | null; away: number | null } };
  }>;
}

/**
 * API-Football adapter — the free tier is the only tier this is built against for now
 * (see DECISIONS.md). Every call is cache-first; nothing here polls on its own, and
 * live polling stays behind the FOOTBALL_LIVE_POLLING_ENABLED flag until real quota exists.
 */
/**
 * `/fixtures/players?fixture={id}`.
 *
 * ## What this shape is, and what it is not
 *
 * Every field below is a COUNT of something a player did. There is not a single
 * coordinate anywhere in this payload, and there is no "touches" field either.
 * API-Football does not publish, on any plan, where on the pitch any of these
 * actions happened. That is the finding the whole heatmap design rests on — see
 * `docs/HEATMAP_ENGINE.md`.
 *
 * ## Confidence in this shape
 *
 * This build environment cannot reach api-football.com (the outbound proxy
 * refuses the CONNECT), so this interface could not be checked against a live
 * response. It is modelled on the documented v3 shape, and every field is
 * declared optional and read through `parseProviderNumber`, so a response that
 * nests differently produces nulls — "the provider did not report this" — rather
 * than a crash or a fabricated zero. If a field turns out to live elsewhere, the
 * failure mode is a missing number, never a wrong one.
 */
interface ApiFootballFixturePlayersResponse {
  response?: Array<{
    team?: { id?: number | null } | null;
    players?: Array<{
      player?: { id?: number | null; name?: string | null } | null;
      statistics?: Array<{
        games?: {
          minutes?: number | string | null;
          position?: string | null;
          rating?: string | number | null;
          substitute?: boolean | null;
        } | null;
        offsides?: number | string | null;
        shots?: { total?: number | string | null; on?: number | string | null } | null;
        goals?: {
          total?: number | string | null;
          conceded?: number | string | null;
          assists?: number | string | null;
          saves?: number | string | null;
        } | null;
        passes?: {
          total?: number | string | null;
          key?: number | string | null;
          accuracy?: number | string | null;
        } | null;
        tackles?: {
          total?: number | string | null;
          blocks?: number | string | null;
          interceptions?: number | string | null;
        } | null;
        duels?: { total?: number | string | null; won?: number | string | null } | null;
        dribbles?: {
          attempts?: number | string | null;
          success?: number | string | null;
          past?: number | string | null;
        } | null;
        fouls?: { drawn?: number | string | null; committed?: number | string | null } | null;
        cards?: { yellow?: number | string | null; red?: number | string | null } | null;
        penalty?: {
          won?: number | string | null;
          commited?: number | string | null;
          scored?: number | string | null;
          missed?: number | string | null;
          saved?: number | string | null;
        } | null;
      }> | null;
    }> | null;
  }> | null;
}

/**
 * `/leagues?season={year}`.
 *
 * The `coverage` object on each season entry is the reason this endpoint is
 * worth a request at all: it is the provider stating, per competition, which
 * of its own endpoints will actually return something. Everything KIVO can say
 * about "this tab can never fill" as opposed to "this tab has not been synced"
 * comes from here and from nowhere else.
 *
 * Same confidence caveat as the interface above — modelled, not observed, and
 * every flag read through `parseCoverageFlag`, which returns null (unknown)
 * for anything that is not literally a boolean.
 */
interface ApiFootballLeaguesResponse {
  response?: Array<{
    league?: { id?: number | null; name?: string | null; type?: string | null; logo?: string | null } | null;
    // The provider's country block for the competition. `name` is the plain
    // country string ("England"), and continental/international competitions
    // are filed under "World". Read here because this is the only endpoint that
    // reports it for competitions KIVO has never synced a fixture for — which
    // is exactly the set the catalogue needs to name.
    country?: { name?: string | null; code?: string | null; flag?: string | null } | null;
    seasons?: Array<{
      year?: number | null;
      coverage?: {
        fixtures?: {
          events?: unknown;
          lineups?: unknown;
          statistics_fixtures?: unknown;
          statistics_players?: unknown;
        } | null;
        standings?: unknown;
        players?: unknown;
        top_scorers?: unknown;
        top_assists?: unknown;
        top_cards?: unknown;
        injuries?: unknown;
        predictions?: unknown;
        odds?: unknown;
      } | null;
    }> | null;
  }> | null;
}

/** `/injuries?league={id}&season={year}`. */
/**
 * `/status` — the account, the subscription and the day's request count, as the
 * provider itself reports them.
 *
 * Read defensively like every other response shape in this file: it is parsed
 * network JSON and nothing about it is guaranteed. Every field lands as null
 * rather than a default when absent, because a fabricated "0 requests used" on
 * an admin screen is worse than an honest blank.
 */
interface ApiFootballStatusResponse {
  response?: {
    account?: { firstname?: string | null; lastname?: string | null; email?: string | null } | null;
    subscription?: { plan?: string | null; end?: string | null; active?: boolean | null } | null;
    requests?: { current?: number | null; limit_day?: number | null } | null;
  } | null;
}

interface ApiFootballInjuriesResponse {
  response?: Array<{
    player?: {
      id?: number | null;
      name?: string | null;
      type?: string | null;
      reason?: string | null;
    } | null;
    team?: { id?: number | null } | null;
    fixture?: { id?: number | null; date?: string | null } | null;
  }> | null;
}

/** `/players/topscorers?league={id}&season={year}`. Ranked by the provider. */
interface ApiFootballTopScorersResponse {
  response?: Array<{
    player?: { id?: number | null; name?: string | null; photo?: string | null } | null;
    statistics?: Array<{
      team?: { id?: number | null; name?: string | null } | null;
      games?: { appearences?: number | string | null; minutes?: number | string | null } | null;
      goals?: { total?: number | string | null; assists?: number | string | null } | null;
      penalty?: { scored?: number | string | null } | null;
    }> | null;
  }> | null;
}

/**
 * `/players?id={id}&season={year}` — one entry per player, with a `statistics`
 * array holding one aggregate per competition they appeared in that season.
 * That per-competition split is what makes a real career breakdown possible,
 * and it is why this is stored one row per competition rather than summed.
 */
interface ApiFootballPlayerSeasonResponse {
  response?: Array<{
    player?: { id?: number | null; name?: string | null } | null;
    statistics?: Array<{
      team?: { id?: number | null; name?: string | null } | null;
      league?: { id?: number | null; name?: string | null; season?: number | null } | null;
      games?: {
        appearences?: number | string | null;
        lineups?: number | string | null;
        minutes?: number | string | null;
        position?: string | null;
        rating?: string | number | null;
      } | null;
      shots?: { total?: number | string | null; on?: number | string | null } | null;
      goals?: {
        total?: number | string | null;
        conceded?: number | string | null;
        assists?: number | string | null;
        saves?: number | string | null;
      } | null;
      passes?: { total?: number | string | null; key?: number | string | null; accuracy?: number | string | null } | null;
      tackles?: { total?: number | string | null; blocks?: number | string | null; interceptions?: number | string | null } | null;
      duels?: { total?: number | string | null; won?: number | string | null } | null;
      dribbles?: { attempts?: number | string | null; success?: number | string | null } | null;
      fouls?: { drawn?: number | string | null; committed?: number | string | null } | null;
      cards?: { yellow?: number | string | null; red?: number | string | null } | null;
      penalty?: { scored?: number | string | null; missed?: number | string | null } | null;
    }> | null;
  }> | null;
}

export class ApiFootballProvider implements FootballDataProvider {
  readonly name = "api-football";

  /** Most recent `x-ratelimit-requests-remaining` value seen on any response
   * from this provider instance (RECOMMENDATIONS item 53) — updated on both
   * successful and failed responses (the header is sent either way), never on
   * a network error (no response to read it from). Null until the first
   * request completes. */
  private quotaRemaining: number | null = null;

  /** RECOMMENDATIONS.md item 65: the last raw response (success or failure)
   * this provider instance actually received, truncated/bounded — see
   * raw-response-sample.ts. Updated on every request, same "most recent
   * wins" lifetime as quotaRemaining above; sync.ts reads it once per run
   * (after getFixturesByDate settles) and writes it to
   * sync_runs.raw_response_sample for admin diagnostics. */
  private lastRawResponseSample: RawResponseSample | null = null;

  constructor(private readonly apiKey: string) {}

  /**
   * Distinguishes 429 (quota exhausted) from 403 (bad key) from other 4xx/5xx
   * (RECOMMENDATIONS item 54), retries exactly once with jitter for a network
   * error or 5xx and never for a 429 (item 55), and records the provider's own
   * remaining-quota header (item 53). The actual fetch/retry/classify logic
   * lives in ./api-football-request so it can be unit-tested with a mocked
   * fetch without importing this server-only module.
   */
  private async request<T>(path: string, revalidateSeconds: number): Promise<T> {
    try {
      const { response, quotaRemaining } = await requestWithRetry({
        path,
        url: `${BASE_URL}${path}`,
        headers: { "x-apisports-key": this.apiKey },
        revalidateSeconds,
      });
      if (quotaRemaining !== null) this.quotaRemaining = quotaRemaining;
      const json = (await response.json()) as T;
      this.lastRawResponseSample = buildRawResponseSample(path, response.status, json);

      // A 200 is not success. API-Football answers a suspended account, an
      // unverified signup, an out-of-plan endpoint and a bad parameter with
      // HTTP 200 and a populated `errors` field — so reading only `response`
      // turns "the provider refused us" into "there is no football today".
      // Those look identical in the database and only one of them is
      // actionable. Raised as the error it is, carrying the provider's own
      // wording so the admin panel can show the founder the actual sentence
      // rather than a green tick over an empty sync.
      const providerError = extractProviderError(json);
      if (providerError) {
        const kind = classifyProviderErrorKind(providerError.key, providerError.message);
        // A plan refusal is rewritten into an instruction, with the provider's
        // own sentence kept inside it. This message is what lands in
        // `sync_runs.error_message` and is the only thing an operator reads
        // when a sync goes red — "Free plans do not have access to this
        // season" tells them nothing about what to do next, and the live
        // database has been carrying exactly that string, unactioned, all day.
        const message =
          kind === "plan"
            ? describePlanRefusal(providerError.message, path)
            : `API-Football refused the request (${providerError.key}): ${providerError.message}`;
        throw new ApiFootballError(message, kind, response.status, quotaRemaining);
      }

      return json;
    } catch (err) {
      if (err instanceof ApiFootballError && err.quotaRemaining !== null) {
        this.quotaRemaining = err.quotaRemaining;
      }
      if (err instanceof ApiFootballError) {
        this.lastRawResponseSample = buildRawResponseSample(path, err.status ?? 0, { error: err.message, kind: err.kind });
      }
      throw err;
    }
  }

  /** Surfaced on Data Health via sync_runs.provider_quota_remaining — real
   * provider data, not an estimate (RECOMMENDATIONS item 53). Null until at
   * least one request has completed. */
  getQuotaRemaining(): number | null {
    return this.quotaRemaining;
  }

  /** RECOMMENDATIONS.md item 65 — see the field's own doc comment above. */
  getLastRawResponseSample(): RawResponseSample | null {
    return this.lastRawResponseSample;
  }

  /**
   * One `/fixtures` response item to a `NormalizedFixture`.
   *
   * Extracted so `/fixtures?date=`, `/fixtures?id=` and `/fixtures?live=all`
   * cannot drift apart: all three return the identical item shape, and three
   * hand-maintained copies of a twenty-field mapping is three chances for one
   * of them to quietly stop carrying half-time scores.
   */
  private mapFixture(item: ApiFootballFixtureResponse["response"][number], retrievedAt: string): NormalizedFixture {
    return {
      provider: this.name,
      providerId: String(item.fixture.id),
      competitionProviderId: String(item.league.id),
      competitionName: item.league.name,
      competitionCountry: item.league.country ?? null,
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
      homeScoreHt: item.score.halftime.home,
      awayScoreHt: item.score.halftime.away,
      matchday: parseMatchday(item.league.round),
      // The label itself, alongside the number parsed out of it. A cup tie has
      // no numbered matchday, so `matchday` is null there and this is the only
      // thing that names the round — see NormalizedFixture.roundLabel.
      roundLabel: item.league.round?.trim() || null,
      referee: item.fixture.referee?.trim() || null,
      venueProviderId: item.fixture.venue.id !== null ? String(item.fixture.venue.id) : null,
      venueName: item.fixture.venue.name,
      venueCity: item.fixture.venue.city?.trim() || null,
      retrievedAt,
    };
  }

  /**
   * Every fixture in play right now, worldwide, in ONE request.
   *
   * That is the shape that makes a live worker affordable at all on a
   * hundred-requests-a-day tier: one request refreshes every live match at once
   * rather than one request per match. It is also immune to the timezone edge
   * `?date=` has, where a match kicking off at 23:50 local belongs to
   * tomorrow's date somewhere.
   *
   * **It returns ONLY in-play matches**, which is the trap. A fixture that goes
   * final between two polls simply stops appearing, so its last written state
   * would be an in-play scoreline that stays on the product until the next
   * daily sync — not a stale score but a permanently wrong one. The worker
   * handles that with a bounded dated fallback (`reconcileDisappearedFixtures`
   * in `scheduled-sync.ts`). None of that belongs in this adapter, which simply
   * reports what the endpoint returns.
   */
  async getLiveFixtures(): Promise<NormalizedFixture[]> {
    const data = await this.request<ApiFootballFixtureResponse>(`/fixtures?live=all`, LIVE_FIXTURE_CACHE_SECONDS);
    const retrievedAt = new Date().toISOString();
    return data.response.map((item) => this.mapFixture(item, retrievedAt));
  }

  async getFixturesByDate(date: string): Promise<NormalizedFixture[]> {
    const data = await this.request<ApiFootballFixtureResponse>(`/fixtures?date=${date}`, FIXTURE_CACHE_SECONDS);
    const retrievedAt = new Date().toISOString();
    return data.response.map((item) => this.mapFixture(item, retrievedAt));
  }

  /**
   * One fixture by the provider's own id.
   *
   * Goes through `mapFixture` like the other two `/fixtures` callers. It used
   * to hold a hand-copied second version of the same twenty-field mapping,
   * which is exactly the drift `mapFixture`'s own doc comment was written to
   * prevent — and it had already drifted: the copy dropped `league.country`,
   * so a fixture refreshed by id lost the competition's country that a dated
   * sync had just written.
   */
  async getFixtureById(providerId: string): Promise<NormalizedFixture | null> {
    const data = await this.request<ApiFootballFixtureResponse>(`/fixtures?id=${providerId}`, FIXTURE_CACHE_SECONDS);
    const retrievedAt = new Date().toISOString();
    const item = data.response[0];
    if (!item) return null;
    return this.mapFixture(item, retrievedAt);
  }

  async getStandings(leagueProviderId: string, season: number): Promise<NormalizedStandingRow[]> {
    const data = await this.request<ApiFootballStandingsResponse>(
      `/standings?league=${leagueProviderId}&season=${season}`,
      STANDINGS_CACHE_SECONDS,
    );
    const league = data.response[0]?.league;
    if (!league) return [];

    return league.standings.flat().map((row) => ({
      provider: this.name,
      team: {
        providerId: String(row.team.id),
        name: row.team.name,
        shortName: null,
        crestUrl: row.team.logo,
      },
      rank: row.rank,
      played: row.all.played,
      won: row.all.win,
      drawn: row.all.draw,
      lost: row.all.lose,
      goalsFor: row.all.goals.for,
      goalsAgainst: row.all.goals.against,
      points: row.points,
      // Verbatim, never classified here. Any "colour this green" decision is a
      // presentation choice made downstream over data that stays intact — see
      // NormalizedStandingRow.zoneDescription.
      zoneDescription: row.description?.trim() || null,
      groupLabel: row.group?.trim() || null,
      form: row.form?.trim() || null,
    }));
  }

  /**
   * Every club in one competition and season — `/teams?league={id}&season={y}`.
   *
   * ## Why this method exists
   *
   * Until it did, a club entered KIVO exactly one way: by appearing in
   * `/fixtures?date=` on a day somebody ran a sync. That is why the live
   * database holds 705 clubs of which none is Real Madrid — Real Madrid did not
   * play on the Tuesday in August when the sync ran, and reserve sides in the
   * Polish third tier did. A directory built out of one day's fixtures is a
   * directory of whoever happened to kick off.
   *
   * This returns the whole league for ONE request, which is the same price as
   * one day of fixtures, and it does not care what day it is.
   *
   * ## What it returns and what it does not
   *
   * The provider sends the crest, the three-letter code, the country, the
   * founding year and the home venue for each club. It does not send squads:
   * players are a separate request PER CLUB (`getSquad`), which is why the
   * catalogue sync treats clubs and squads as two different budgets — see
   * `sync-catalogue.ts`.
   *
   * An empty response is a real answer (a season the provider has not set up
   * for this league) and is returned as an empty array, never as a failure and
   * never backfilled from another season.
   */
  async getTeamsByLeague(leagueProviderId: string, season: number): Promise<NormalizedTeamProfile[]> {
    const data = await this.request<ApiFootballTeamsResponse>(
      `/teams?league=${encodeURIComponent(leagueProviderId)}&season=${season}`,
      TEAMS_CACHE_SECONDS,
    );

    const profiles: NormalizedTeamProfile[] = [];
    for (const entry of data.response ?? []) {
      const id = entry.team?.id;
      const name = entry.team?.name;
      // A club with no id cannot be mapped and a club with no name cannot be
      // displayed. Skipped rather than inserted under a placeholder — a row
      // named "Unknown" is worse than a row that is not there.
      if (id === null || id === undefined || !name) continue;
      profiles.push({
        providerId: String(id),
        name,
        shortName: entry.team?.code ?? null,
        crestUrl: entry.team?.logo ?? null,
        country: entry.team?.country ?? null,
        founded: typeof entry.team?.founded === "number" ? entry.team.founded : null,
        venueProviderId:
          entry.venue?.id === null || entry.venue?.id === undefined ? null : String(entry.venue.id),
        venueName: entry.venue?.name ?? null,
        venueCity: entry.venue?.city ?? null,
      });
    }
    return profiles;
  }

  /**
   * The free-tier `/players/squads?team={id}` listing endpoint only returns
   * id/name/age/number/position/photo per player — no date of birth, no
   * nationality, and (checked directly against the response shape) no market
   * value field anywhere on this or any other endpoint. Full player profiles
   * with birth date/nationality live behind the heavier `/players?id=&season=`
   * endpoint, which is a per-player, per-season call — fetching that for a
   * whole squad would burn the 100-requests/day free quota in a couple of
   * teams, so it's intentionally not called here. dateOfBirth/nationality are
   * left null rather than estimated from `age`.
   *
   * `photo` IS mapped through (RECOMMENDATIONS.md item 56) — it's real
   * provider data already fetched and paid for in quota on every call this
   * method makes, unlike dateOfBirth/nationality which would cost an
   * additional per-player request the free tier can't afford.
   */
  async getSquad(teamProviderId: string): Promise<NormalizedPlayer[]> {
    const data = await this.request<ApiFootballSquadResponse>(`/players/squads?team=${teamProviderId}`, SQUAD_CACHE_SECONDS);
    const squad = data.response[0];
    if (!squad) return [];

    return squad.players.map((p) => ({
      providerId: String(p.id),
      fullName: p.name,
      knownAs: null,
      dateOfBirth: null,
      nationality: null,
      position: p.position,
      photoUrl: p.photo,
    }));
  }

  /**
   * `/coachs?team={id}` returns the coaching staff API-Football has on file for
   * this team, most-recent-first, with no explicit "is current" flag — response[0]
   * is treated as the current manager, the same assumption most API-Football
   * integrations make. Returns null if the provider has no coach on file at all.
   */
  async getManager(teamProviderId: string): Promise<NormalizedManager | null> {
    const data = await this.request<ApiFootballCoachResponse>(`/coachs?team=${teamProviderId}`, MANAGER_CACHE_SECONDS);
    const coach = data.response[0];
    if (!coach) return null;

    const fullName = coach.name || [coach.firstname, coach.lastname].filter(Boolean).join(" ").trim() || "Unknown";

    return {
      providerId: String(coach.id),
      fullName,
      nationality: coach.nationality,
      dateOfBirth: coach.birth?.date ?? null,
    };
  }

  async getLineups(fixtureProviderId: string): Promise<NormalizedLineups | null> {
    const data = await this.request<ApiFootballLineupsResponse>(
      `/fixtures/lineups?fixture=${fixtureProviderId}`,
      LINEUP_CACHE_SECONDS,
    );
    if (data.response.length === 0) return null;

    return {
      fixtureProviderId,
      teams: data.response.map((side) => ({
        team: {
          providerId: String(side.team.id),
          name: side.team.name,
          shortName: null,
          crestUrl: side.team.logo,
        },
        formation: side.formation,
        entries: [
          ...side.startXI.map(({ player }) => ({
            playerProviderId: String(player.id),
            playerName: player.name,
            isStarting: true,
            shirtNumber: player.number,
            position: player.pos,
            // Real provider data already paid for by this same request — the
            // same reasoning that maps `photo` through on getSquad. Passed
            // through raw; `parsePitchGrid` owns the row/col semantics.
            grid: player.grid ?? null,
          })),
          ...side.substitutes.map(({ player }) => ({
            playerProviderId: String(player.id),
            playerName: player.name,
            isStarting: false,
            shirtNumber: player.number,
            position: player.pos,
            // A substitute has no formation slot to report. Null, not "0:0".
            grid: player.grid ?? null,
          })),
        ],
      })),
    };
  }

  async getMatchEvents(fixtureProviderId: string): Promise<NormalizedMatchEvent[]> {
    const data = await this.request<ApiFootballEventsResponse>(
      `/fixtures/events?fixture=${fixtureProviderId}`,
      EVENTS_CACHE_SECONDS,
    );

    return data.response.map((item) => {
      const playerKey = item.player.id !== null ? String(item.player.id) : "x";
      // See NormalizedMatchEvent.providerId doc comment — API-Football gives events no
      // stable id of their own, so this composite key stands in for one.
      const providerId = [
        fixtureProviderId,
        item.team.id,
        playerKey,
        item.time.elapsed,
        item.time.extra ?? 0,
        item.type,
        item.detail,
      ].join(":");

      return {
        providerId,
        teamProviderId: String(item.team.id),
        playerProviderId: item.player.id !== null ? String(item.player.id) : null,
        playerName: item.player.name,
        relatedPlayerProviderId: item.assist.id !== null ? String(item.assist.id) : null,
        relatedPlayerName: item.assist.name,
        eventType: mapEventType(item.type, item.detail),
        minute: item.time.elapsed,
        addedTime: item.time.extra,
        detail: item.detail,
      };
    });
  }

  /**
   * `/fixtures/statistics?fixture={id}` returns one entry per side, each with a flat
   * `statistics` array of {type, value} pairs — see mapFixtureStatistics's doc comment
   * in normalizers.ts for how those get matched onto fixture_statistics' fixed columns.
   * Returns null (not an empty array) when the provider has no statistics published
   * yet for this fixture — the same "nothing yet" convention as getLineups, common
   * before kickoff or on a competition tier that doesn't report them.
   */
  async getFixtureStatistics(fixtureProviderId: string): Promise<NormalizedFixtureStatistics | null> {
    const data = await this.request<ApiFootballStatisticsResponse>(
      `/fixtures/statistics?fixture=${fixtureProviderId}`,
      STATISTICS_CACHE_SECONDS,
    );
    if (data.response.length === 0) return null;

    return {
      fixtureProviderId,
      teams: data.response.map((side) => ({
        team: {
          providerId: String(side.team.id),
          name: side.team.name,
          shortName: null,
          crestUrl: side.team.logo,
        },
        ...mapFixtureStatistics(side.statistics),
      })),
    };
  }

  /**
   * `/transfers?player={id}` returns this player's full recorded transfer history —
   * real, already-happened moves only, no rumour/reported tier on any API-Football
   * plan (see AGENTS.md). Response is one entry per player with a nested `transfers`
   * array; order isn't documented as newest-first, so callers must not assume one.
   */
  async getPlayerTransfers(playerProviderId: string): Promise<NormalizedTransfer[]> {
    const data = await this.request<ApiFootballTransfersResponse>(
      `/transfers?player=${playerProviderId}`,
      TRANSFERS_CACHE_SECONDS,
    );
    const entry = data.response[0];
    if (!entry) return [];

    return entry.transfers.map((t) => {
      const feeText = t.type && t.type.trim().length > 0 ? t.type : null;
      // Synthetic composite key — see NormalizedTransfer.providerId doc comment.
      const providerId = [
        playerProviderId,
        t.date,
        t.teams.out?.id ?? "x",
        t.teams.in?.id ?? "x",
        feeText ?? "x",
      ].join(":");

      return {
        providerId,
        playerProviderId,
        fromTeamProviderId: t.teams.out?.id != null ? String(t.teams.out.id) : null,
        fromTeamName: t.teams.out?.name ?? null,
        toTeamProviderId: t.teams.in?.id != null ? String(t.teams.in.id) : null,
        toTeamName: t.teams.in?.name ?? null,
        transferDate: t.date,
        feeText,
        transferType: mapTransferType(feeText),
      };
    });
  }

  /**
   * `/transfers?team={id}` — every recorded transfer involving this club, for
   * every player, in one request.
   *
   * Same response envelope as `?player=`: an array of per-player entries, each
   * carrying that player's nested `transfers` list. The difference is the
   * filter, and the difference is the whole point — one request instead of one
   * per squad member. See ProviderAdapter.getTeamTransfers for why that matters
   * at all on this tier.
   *
   * The provider returns a player's transfers *involving this club*, which
   * includes both the arrival and the eventual departure. Both are real moves
   * and both are returned; deduplication is the sync's job, and it already has
   * one, keyed on the same synthetic composite id `getPlayerTransfers` builds.
   *
   * An entry whose player has no usable name is dropped rather than stored
   * under a placeholder: a transfer row KIVO cannot attribute to a named player
   * is not information, it is a blank line on somebody's profile.
   */
  async getTeamTransfers(teamProviderId: string): Promise<NormalizedTeamTransfer[]> {
    const data = await this.request<ApiFootballTransfersResponse>(
      `/transfers?team=${teamProviderId}`,
      TRANSFERS_CACHE_SECONDS,
    );

    const out: NormalizedTeamTransfer[] = [];
    for (const entry of data.response) {
      const playerName = entry.player?.name?.trim();
      if (!playerName || entry.player.id == null) continue;
      const playerProviderId = String(entry.player.id);

      for (const t of entry.transfers) {
        const feeText = t.type && t.type.trim().length > 0 ? t.type : null;
        // Identical composite key to getPlayerTransfers', deliberately: the
        // same move fetched by team and by player must resolve to the same
        // provider_mappings row, or a club sync and a player sync would each
        // insert their own copy of one transfer.
        const providerId = [
          playerProviderId,
          t.date,
          t.teams.out?.id ?? "x",
          t.teams.in?.id ?? "x",
          feeText ?? "x",
        ].join(":");

        out.push({
          providerId,
          playerProviderId,
          playerName,
          fromTeamProviderId: t.teams.out?.id != null ? String(t.teams.out.id) : null,
          fromTeamName: t.teams.out?.name ?? null,
          toTeamProviderId: t.teams.in?.id != null ? String(t.teams.in.id) : null,
          toTeamName: t.teams.in?.name ?? null,
          transferDate: t.date,
          feeText,
          transferType: mapTransferType(feeText),
        });
      }
    }
    return out;
  }

  /**
   * Per-player statistics for one fixture — minutes, shots, passes, tackles,
   * interceptions, duels, dribbles, fouls and the provider's own rating, for
   * every player who appeared.
   *
   * **No coordinates.** This endpoint reports what each player did, never where.
   * Nothing downstream may present anything built on it as a positional
   * heatmap; see `src/lib/football/heatmap/` for the labelling that requirement
   * turns into.
   *
   * Returns null when the response carries no players — which covers both "not
   * published yet" (a fixture that has not kicked off) and "this plan or this
   * competition never publishes it". Those two are genuinely different, and
   * this method cannot tell them apart; the coverage registry can, which is why
   * `syncFixturePlayerStatistics` asks it before spending a request here.
   */
  async getFixturePlayerStatistics(fixtureProviderId: string): Promise<NormalizedFixturePlayerStatistics | null> {
    const data = await this.request<ApiFootballFixturePlayersResponse>(
      `/fixtures/players?fixture=${fixtureProviderId}`,
      FIXTURE_PLAYERS_CACHE_SECONDS,
    );
    const sides = data.response ?? [];
    if (sides.length === 0) return null;

    const players: NormalizedFixturePlayerStatistics["players"] = [];
    for (const side of sides) {
      const teamId = side.team?.id;
      if (teamId === null || teamId === undefined) continue;
      for (const entry of side.players ?? []) {
        const playerId = entry.player?.id;
        if (playerId === null || playerId === undefined) continue;
        // The provider nests a one-element array here (a shape it shares with
        // the season endpoint, where the array genuinely has many entries).
        // Reading [0] rather than assuming a length keeps a differently-shaped
        // response producing nulls instead of throwing.
        const st = entry.statistics?.[0];
        players.push({
          playerProviderId: String(playerId),
          playerName: entry.player?.name ?? "",
          teamProviderId: String(teamId),
          minutesPlayed: parseProviderNumber(st?.games?.minutes),
          position: st?.games?.position ?? null,
          // Deliberately not `?? false`: "the provider did not say" is not the
          // same claim as "this player started".
          isSubstitute: typeof st?.games?.substitute === "boolean" ? st.games.substitute : null,
          providerRating: parseProviderNumber(st?.games?.rating),
          shotsTotal: parseProviderNumber(st?.shots?.total),
          shotsOnTarget: parseProviderNumber(st?.shots?.on),
          goals: parseProviderNumber(st?.goals?.total),
          assists: parseProviderNumber(st?.goals?.assists),
          goalsConceded: parseProviderNumber(st?.goals?.conceded),
          saves: parseProviderNumber(st?.goals?.saves),
          passesTotal: parseProviderNumber(st?.passes?.total),
          passesKey: parseProviderNumber(st?.passes?.key),
          passAccuracy: parseProviderNumber(st?.passes?.accuracy),
          tacklesTotal: parseProviderNumber(st?.tackles?.total),
          blocks: parseProviderNumber(st?.tackles?.blocks),
          interceptions: parseProviderNumber(st?.tackles?.interceptions),
          duelsTotal: parseProviderNumber(st?.duels?.total),
          duelsWon: parseProviderNumber(st?.duels?.won),
          dribblesAttempted: parseProviderNumber(st?.dribbles?.attempts),
          dribblesSucceeded: parseProviderNumber(st?.dribbles?.success),
          dribbledPast: parseProviderNumber(st?.dribbles?.past),
          foulsDrawn: parseProviderNumber(st?.fouls?.drawn),
          foulsCommitted: parseProviderNumber(st?.fouls?.committed),
          yellowCards: parseProviderNumber(st?.cards?.yellow),
          redCards: parseProviderNumber(st?.cards?.red),
          offsides: parseProviderNumber(st?.offsides),
          penaltiesWon: parseProviderNumber(st?.penalty?.won),
          // API-Football's own field is spelled "commited". Mirrored exactly,
          // with this note, so a future reader does not "fix" it into a field
          // that does not exist and silently turn a real number into null.
          penaltiesCommitted: parseProviderNumber(st?.penalty?.commited),
          penaltiesScored: parseProviderNumber(st?.penalty?.scored),
          penaltiesMissed: parseProviderNumber(st?.penalty?.missed),
          penaltiesSaved: parseProviderNumber(st?.penalty?.saved),
        });
      }
    }

    if (players.length === 0) return null;
    return { fixtureProviderId, players };
  }

  /**
   * The provider's own declaration of what it supports, per competition, for
   * one season — one request that answers "can this tab ever fill?" for every
   * competition at once.
   *
   * This is the single highest-value request on the whole API for a product
   * whose problem is empty tabs, because it is the only one that returns a
   * *capability* rather than data. One request a week (see
   * COVERAGE_CACHE_SECONDS) buys the difference between an honest
   * "this competition doesn't publish lineups" and a misleading
   * "nothing synced yet" on every surface in KIVO.
   *
   * Flags are read through `parseCoverageFlag`, so a key the provider omits
   * stays null rather than becoming false. That distinction is the registry's
   * entire reason to exist: null is "KIVO does not know", false is "the
   * provider says never", and rendering the first as the second would make
   * KIVO assert a limitation nobody claimed.
   */
  async getCompetitionCoverage(season: number): Promise<NormalizedCompetitionCoverage[]> {
    const data = await this.request<ApiFootballLeaguesResponse>(
      `/leagues?season=${season}`,
      COVERAGE_CACHE_SECONDS,
    );

    const rows: NormalizedCompetitionCoverage[] = [];
    for (const entry of data.response ?? []) {
      const leagueId = entry.league?.id;
      if (leagueId === null || leagueId === undefined) continue;
      for (const seasonEntry of entry.seasons ?? []) {
        // The response carries every season the plan can see, not only the one
        // asked for. Filtering here rather than trusting the query parameter
        // means a row can never be filed under the wrong season.
        if (seasonEntry.year !== season) continue;
        const c = seasonEntry.coverage;
        rows.push({
          competitionProviderId: String(leagueId),
          competitionName: entry.league?.name ?? "",
          competitionCountry: entry.country?.name ?? null,
          competitionLogoUrl: entry.league?.logo ?? null,
          competitionType: entry.league?.type ?? null,
          season,
          fixtureEvents: parseCoverageFlag(c?.fixtures?.events),
          fixtureLineups: parseCoverageFlag(c?.fixtures?.lineups),
          fixtureStatistics: parseCoverageFlag(c?.fixtures?.statistics_fixtures),
          fixturePlayerStatistics: parseCoverageFlag(c?.fixtures?.statistics_players),
          standings: parseCoverageFlag(c?.standings),
          players: parseCoverageFlag(c?.players),
          topScorers: parseCoverageFlag(c?.top_scorers),
          topAssists: parseCoverageFlag(c?.top_assists),
          topCards: parseCoverageFlag(c?.top_cards),
          injuries: parseCoverageFlag(c?.injuries),
          predictions: parseCoverageFlag(c?.predictions),
          odds: parseCoverageFlag(c?.odds),
          raw: c ?? null,
        });
      }
    }
    return rows;
  }

  /**
   * Current injury and unavailability reports for one competition and season.
   *
   * `docs/API_FOOTBALL.md` records injuries as unavailable on the free tier.
   * That claim is not contradicted here and it is not assumed either: this
   * method exists so the capability is reachable the moment the plan or the
   * competition allows it, and `syncInjuries` checks the coverage registry
   * first so a plan that genuinely cannot serve this never spends a request
   * finding out twice.
   *
   * The synthetic key mirrors the transfer/event convention — the endpoint
   * publishes no per-row id, so one is derived from the fields that identify a
   * report, and it stays stable across re-fetches of the same report.
   */
  async getInjuries(competitionProviderId: string, season: number): Promise<NormalizedInjury[]> {
    const data = await this.request<ApiFootballInjuriesResponse>(
      `/injuries?league=${competitionProviderId}&season=${season}`,
      INJURIES_CACHE_SECONDS,
    );

    const rows: NormalizedInjury[] = [];
    for (const entry of data.response ?? []) {
      const playerId = entry.player?.id;
      if (playerId === null || playerId === undefined) continue;
      const fixtureId = entry.fixture?.id ?? null;
      // The date is taken from the fixture the report is attached to, and only
      // its date part — the provider gives no separate "reported on" field, and
      // inventing one from `now` would date every report to whenever KIVO
      // happened to sync.
      const reportedOn = typeof entry.fixture?.date === "string" ? entry.fixture.date.slice(0, 10) : null;
      rows.push({
        providerId: [competitionProviderId, season, playerId, fixtureId ?? "x", entry.player?.type ?? "x"].join(":"),
        playerProviderId: String(playerId),
        playerName: entry.player?.name ?? "",
        teamProviderId: entry.team?.id != null ? String(entry.team.id) : null,
        fixtureProviderId: fixtureId != null ? String(fixtureId) : null,
        status: mapInjuryStatus(entry.player?.type),
        reason: entry.player?.reason ?? null,
        reportedOn,
      });
    }
    return rows;
  }

  /**
   * The competition's scoring chart, in the provider's own ranked order.
   *
   * Rank is the array index, not a recomputation from goals: the provider
   * applies the competition's real tie-breaks (goals, then assists, then
   * minutes, in most leagues) and re-sorting here would quietly substitute
   * JavaScript's idea of a tie for the competition's.
   */
  async getTopScorers(competitionProviderId: string, season: number): Promise<NormalizedTopScorer[]> {
    const data = await this.request<ApiFootballTopScorersResponse>(
      `/players/topscorers?league=${competitionProviderId}&season=${season}`,
      TOP_SCORERS_CACHE_SECONDS,
    );

    const rows: NormalizedTopScorer[] = [];
    let rank = 0;
    for (const entry of data.response ?? []) {
      const playerId = entry.player?.id;
      if (playerId === null || playerId === undefined) continue;
      rank += 1;
      const st = entry.statistics?.[0];
      rows.push({
        rank,
        playerProviderId: String(playerId),
        playerName: entry.player?.name ?? "",
        playerPhotoUrl: entry.player?.photo ?? null,
        teamProviderId: st?.team?.id != null ? String(st.team.id) : null,
        teamName: st?.team?.name ?? null,
        goals: parseProviderNumber(st?.goals?.total),
        assists: parseProviderNumber(st?.goals?.assists),
        penaltiesScored: parseProviderNumber(st?.penalty?.scored),
        // API-Football spells this "appearences". Mirrored deliberately.
        appearances: parseProviderNumber(st?.games?.appearences),
        minutesPlayed: parseProviderNumber(st?.games?.minutes),
      });
    }
    return rows;
  }

  /**
   * One player's season aggregates, one row per competition they appeared in.
   *
   * The per-competition split is kept rather than summed, because summing is
   * lossy and irreversible: "14 goals" cannot be turned back into "11 in the
   * league, 3 in the cup", and the competition split is the whole point of a
   * career breakdown. Anything that wants a total can add these up; nothing can
   * take a total apart.
   */
  async getPlayerSeasonStatistics(
    playerProviderId: string,
    season: number,
  ): Promise<NormalizedPlayerSeasonStatistics[]> {
    const data = await this.request<ApiFootballPlayerSeasonResponse>(
      `/players?id=${playerProviderId}&season=${season}`,
      PLAYER_SEASON_CACHE_SECONDS,
    );

    const entry = data.response?.[0];
    if (!entry) return [];
    const playerName = entry.player?.name ?? "";

    const rows: NormalizedPlayerSeasonStatistics[] = [];
    for (const st of entry.statistics ?? []) {
      const leagueId = st.league?.id;
      // A competition KIVO cannot identify cannot be filed against one. Dropped
      // rather than bucketed into an "other competitions" row, which would be a
      // number nobody could trace back to a real competition.
      if (leagueId === null || leagueId === undefined) continue;
      rows.push({
        playerProviderId,
        playerName,
        competitionProviderId: String(leagueId),
        competitionName: st.league?.name ?? null,
        season: typeof st.league?.season === "number" ? st.league.season : season,
        teamProviderId: st.team?.id != null ? String(st.team.id) : null,
        teamName: st.team?.name ?? null,
        position: st.games?.position ?? null,
        appearances: parseProviderNumber(st.games?.appearences),
        lineups: parseProviderNumber(st.games?.lineups),
        minutesPlayed: parseProviderNumber(st.games?.minutes),
        providerRating: parseProviderNumber(st.games?.rating),
        goals: parseProviderNumber(st.goals?.total),
        assists: parseProviderNumber(st.goals?.assists),
        goalsConceded: parseProviderNumber(st.goals?.conceded),
        saves: parseProviderNumber(st.goals?.saves),
        shotsTotal: parseProviderNumber(st.shots?.total),
        shotsOnTarget: parseProviderNumber(st.shots?.on),
        passesTotal: parseProviderNumber(st.passes?.total),
        passesKey: parseProviderNumber(st.passes?.key),
        passAccuracy: parseProviderNumber(st.passes?.accuracy),
        tacklesTotal: parseProviderNumber(st.tackles?.total),
        blocks: parseProviderNumber(st.tackles?.blocks),
        interceptions: parseProviderNumber(st.tackles?.interceptions),
        duelsTotal: parseProviderNumber(st.duels?.total),
        duelsWon: parseProviderNumber(st.duels?.won),
        dribblesAttempted: parseProviderNumber(st.dribbles?.attempts),
        dribblesSucceeded: parseProviderNumber(st.dribbles?.success),
        foulsDrawn: parseProviderNumber(st.fouls?.drawn),
        foulsCommitted: parseProviderNumber(st.fouls?.committed),
        yellowCards: parseProviderNumber(st.cards?.yellow),
        redCards: parseProviderNumber(st.cards?.red),
        penaltiesScored: parseProviderNumber(st.penalty?.scored),
        penaltiesMissed: parseProviderNumber(st.penalty?.missed),
      });
    }
    return rows;
  }

  /**
   * The account behind `API_FOOTBALL_KEY`, in the provider's own words.
   *
   * This exists because of one sentence the live database recorded and nothing
   * in KIVO could explain: "Free plans do not have access to this season, try
   * from 2022 to 2024." Every season-scoped sync was failing, and the only way
   * to know why was to read a raw error string at the bottom of a sync run.
   * `/status` is the provider's answer to "what am I actually paying for", it
   * takes no season parameter, and it therefore still answers on exactly the
   * plan whose seasons are refused.
   *
   * Nothing here is derived or estimated. A field the provider omits is null.
   */
  async getProviderPlan(): Promise<NormalizedProviderPlan | null> {
    const data = await this.request<ApiFootballStatusResponse>("/status", STATUS_CACHE_SECONDS);
    const body = data.response;
    if (!body) return null;

    const name = [body.account?.firstname, body.account?.lastname]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ");
    const email = typeof body.account?.email === "string" ? body.account.email : null;

    return {
      planName: typeof body.subscription?.plan === "string" ? body.subscription.plan : null,
      active: typeof body.subscription?.active === "boolean" ? body.subscription.active : null,
      endsAt: typeof body.subscription?.end === "string" ? body.subscription.end : null,
      requestsToday: parseProviderNumber(body.requests?.current),
      requestsPerDay: parseProviderNumber(body.requests?.limit_day),
      accountLabel: name.length > 0 ? name : email,
    };
  }
}
