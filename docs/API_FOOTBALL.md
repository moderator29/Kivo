# API-Football provider

The primary, default `FootballDataProvider` implementation. Source: `src/lib/football/providers/api-football.ts` (fetch orchestration in `./api-football-request.ts`, response normalizers in `./normalizers.ts`).

## Plan and base URL

Free ("hobbyist") tier only, per the project's $0-budget standing decision (see `DECISIONS.md`'s 2026-08-14 entry) — no paid tier is assumed anywhere in this file. **100 requests/day, 10 requests/minute.**

Base URL: `https://v3.football.api-sports.io`. Auth: `x-apisports-key` request header, set from `API_FOOTBALL_KEY`.

## Endpoints actually called

| Method | Endpoint | Notes |
|---|---|---|
| `getFixturesByDate` | `GET /fixtures?date={date}` | |
| `getFixtureById` | `GET /fixtures?id={id}` | |
| `getStandings` | `GET /standings?league={id}&season={season}` | Flattens grouped standings (e.g. Champions League group stage) into one row list |
| `getSquad` | `GET /players/squads?team={id}` | See "Known free-tier gaps" below |
| `getManager` | `GET /coachs?team={id}` | Most-recent entry treated as current — no explicit "is current" flag on the response |
| `getLineups` | `GET /fixtures/lineups?fixture={id}` | Null (not empty array) when no lineup is published yet |
| `getMatchEvents` | `GET /fixtures/events?fixture={id}` | Synthesizes a stable composite id per event — the endpoint has no native one |
| `getFixtureStatistics` | `GET /fixtures/statistics?fixture={id}` | Null when not published yet or the competition tier doesn't report them |
| `getPlayerTransfers` | `GET /transfers?player={id}` | Confirmed/real moves only — no rumour tier exists on any API-Football plan |

## Known free-tier gaps (confirmed by reading the actual response shape, not assumed)

- `getSquad` returns id/name/age/number/position/photo only — **no date of birth, no nationality**. Full profiles live behind a separate, heavier per-player-per-season endpoint (`/players?id=&season=`) that isn't called here, because fetching it for a whole squad would burn the entire daily quota in a couple of teams. `dateOfBirth`/`nationality` are left `null` rather than estimated from `age`.
- No player market value field exists anywhere on any endpoint (checked directly against the response shape, not inferred).
- Injuries, referees, per-match individual player stats, and xG on most competitions are not available on the free tier.
- `photo` **is** mapped through on `getSquad` — it's real data already fetched and paid for in quota on every call, unlike dateOfBirth/nationality which would cost an additional per-player request.

## Quota and retry handling

See `docs/API_QUOTA.md` for the full write-up. In short: every response's `x-ratelimit-requests-remaining` header is parsed and surfaced; a 429 never retries; a network error or 5xx gets exactly one jittered retry; any other 4xx (bad key, bad params) never retries.

## Cache windows (`Next.js` `fetch` `revalidate`, per endpoint)

See `docs/CACHING_STRATEGY.md` for the full reasoning — summarized here for reference:

| Data | Window | Why |
|---|---|---|
| Fixtures | 300s | Free-tier-friendly; avoids re-fetching the same day repeatedly |
| Squads / managers | 86,400s (1 day) | Changes rarely |
| Lineups / events / statistics | 120s | Can change mid-match, but never zero — protects against a busy admin screen re-triggering a sync repeatedly |
| Standings | 3,600s (1 hour) | Settles slowly outside matchdays |
| Transfers | 172,800s (2 days) | Append-only, historical fact once recorded |
