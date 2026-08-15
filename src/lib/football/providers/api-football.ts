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
import { mapEventType, mapFixtureStatistics, mapStatus, mapTransferType } from "./normalizers";
import { ApiFootballError, requestWithRetry } from "./api-football-request";

const BASE_URL = "https://v3.football.api-sports.io";

/** Free-tier friendly cache window — avoid re-fetching the same day's fixtures repeatedly. */
const FIXTURE_CACHE_SECONDS = 300;

// API-Football's free ("Free"/hobbyist) plan is 100 requests/day and 10 requests/minute
// (see api-football.com/pricing) — there is no other tier assumed anywhere in this file,
// per the project's $0 budget. Every window below is chosen to make on-demand, per-team/
// per-fixture syncing survive that quota rather than to serve "freshness" for its own sake.
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
/** Transfer history is append-only and barely changes day to day — cache well beyond
 * a single day so re-visiting a player's profile never burns fresh quota for data
 * that's already historical fact. */
const TRANSFERS_CACHE_SECONDS = 172_800;

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
    startXI: Array<{ player: { id: number; name: string; number: number | null; pos: string | null } }>;
    substitutes: Array<{ player: { id: number; name: string; number: number | null; pos: string | null } }>;
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
      venue: { id: number | null; name: string | null };
    };
    league: { id: number; name: string; season: number };
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
export class ApiFootballProvider implements FootballDataProvider {
  readonly name = "api-football";

  /** Most recent `x-ratelimit-requests-remaining` value seen on any response
   * from this provider instance (RECOMMENDATIONS item 53) — updated on both
   * successful and failed responses (the header is sent either way), never on
   * a network error (no response to read it from). Null until the first
   * request completes. */
  private quotaRemaining: number | null = null;

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
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof ApiFootballError && err.quotaRemaining !== null) {
        this.quotaRemaining = err.quotaRemaining;
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

  async getFixturesByDate(date: string): Promise<NormalizedFixture[]> {
    const data = await this.request<ApiFootballFixtureResponse>(`/fixtures?date=${date}`, FIXTURE_CACHE_SECONDS);
    const retrievedAt = new Date().toISOString();

    return data.response.map((item) => ({
      provider: this.name,
      providerId: String(item.fixture.id),
      competitionProviderId: String(item.league.id),
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
      homeScoreHt: item.score.halftime.home,
      awayScoreHt: item.score.halftime.away,
      venueProviderId: item.fixture.venue.id !== null ? String(item.fixture.venue.id) : null,
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
      competitionProviderId: String(item.league.id),
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
      homeScoreHt: item.score.halftime.home,
      awayScoreHt: item.score.halftime.away,
      venueProviderId: item.fixture.venue.id !== null ? String(item.fixture.venue.id) : null,
      venueName: item.fixture.venue.name,
      retrievedAt,
    };
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
    }));
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
          })),
          ...side.substitutes.map(({ player }) => ({
            playerProviderId: String(player.id),
            playerName: player.name,
            isStarting: false,
            shirtNumber: player.number,
            position: player.pos,
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
}
