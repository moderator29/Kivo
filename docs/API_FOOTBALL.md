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
| `getFixturePlayerStatistics` | `GET /fixtures/players?fixture={id}` | Per-player match numbers. **Counts only — no coordinates.** Null when nothing is published |
| `getCompetitionCoverage` | `GET /leagues?season={year}` | The coverage registry's source. See below |
| `getInjuries` | `GET /injuries?league={id}&season={year}` | Availability is competition-dependent — ask the coverage registry first |
| `getTopScorers` | `GET /players/topscorers?league={id}&season={year}` | Provider's own ranking, stored as sent |
| `getPlayerSeasonStatistics` | `GET /players?id={id}&season={year}` | One entry per competition the player appeared in |

## The coverage registry — the provider's own answer to "can this ever fill?"

`GET /leagues?season={year}` returns, per competition per season, a `coverage`
object stating which of API-Football's own endpoints will actually return
something for it: `fixtures.events`, `fixtures.lineups`,
`fixtures.statistics_fixtures`, `fixtures.statistics_players`, `standings`,
`players`, `top_scorers`, `top_assists`, `top_cards`, `injuries`,
`predictions`, `odds`.

This is the single highest-value request on the whole API for a product whose
problem is empty tabs, because it is the only one that returns a **capability**
rather than data — and it costs one request for every competition at once. It
is stored in `provider_coverage` (migration 0082) and read through
`src/lib/football/coverage-registry.ts`.

Every flag is stored as a **nullable** boolean, and the three states are
genuinely different:

- `true` — the provider supports it. An empty tab means unsynced.
- `false` — the provider does not. No amount of syncing will ever fill it.
- `null` — the provider stated nothing. KIVO does not know.

`null` must never render or behave as `false`. Every quota-spending sync asks
the registry and skips **only** on a definite `false`; `null` attempts once and
lets the response be the evidence. A sync that skipped on unknown would mean a
KIVO that has not yet refreshed its registry silently stops fetching
everything.

## The coordinate question, answered once

**No API-Football endpoint on any plan returns pitch coordinates.**
`/fixtures/events` is a minute-stamped list; `/fixtures/players` is counts, with
no `touches` field. The only positional field the API publishes anywhere is
`grid` on `/fixtures/lineups`' `startXI` entries — a `"row:col"` formation slot,
which says where a player *lined up*, not where they went. It is mapped through
to `NormalizedLineupEntry.grid` and stored on `lineups.grid`, because it arrives
free on a request KIVO already makes.

See `docs/HEATMAP_ENGINE.md` for what may and may not be built on top of that.

## Known free-tier gaps (confirmed by reading the actual response shape, not assumed)

- `getSquad` returns id/name/age/number/position/photo only — **no date of birth, no nationality**. Full profiles live behind a separate, heavier per-player-per-season endpoint (`/players?id=&season=`) that isn't called here, because fetching it for a whole squad would burn the entire daily quota in a couple of teams. `dateOfBirth`/`nationality` are left `null` rather than estimated from `age`.
- No player market value field exists anywhere on any endpoint (checked directly against the response shape, not inferred).
- Referees are not available.
- **Injuries and per-match individual player statistics were recorded here as
  free-tier-unavailable.** That was not re-verified in the build that added them
  (this environment cannot reach api-football.com), and it is deliberately not
  treated as settled either way: both are now implemented, and both ask the
  coverage registry per competition before spending a request. The registry is
  the provider's own statement about exactly this, so the question resolves
  itself the first time it is synced against a live key rather than being
  guessed at here.
- **xG** is parsed from `/fixtures/statistics` into
  `fixture_statistics.expected_goals` when the competition reports it, and left
  null when it does not. Surfacing it more prominently should be gated on the
  registry rather than attempted everywhere — see `KIVO_NEXT_GEN.md` KN-144.
- `photo` **is** mapped through on `getSquad` — it's real data already fetched and paid for in quota on every call, unlike dateOfBirth/nationality which would cost an additional per-player request.

## Assists: where they actually come from

Recorded because this was got wrong once, in writing — `RECOMMENDATIONS.md` item 328 claimed KIVO had no assist data anywhere. It was wrong, and the correction is worth more than the original claim.

There is **no `assist` member in KIVO's `fixture_event_type` enum**, which is what that claim was really observing. But API-Football does not model an assist as an event. It attaches the assister to the goal:

```
GET /fixtures/events?fixture={id}
  response[].player  -> { id, name }   the scorer
  response[].assist  -> { id, name }   the assister
```

`normalizers.ts` maps that second object to `relatedPlayerProviderId`/`relatedPlayerName`, and `sync-match-details.ts` resolves it into `fixture_events.related_player_id`. That column has carried real assists since the first version of the sync, and `src/lib/fantasy-scoring.ts` has been awarding `ASSIST_POINTS` from it the whole time — so the data was not merely present, it was already in production use while a backlog item said it did not exist.

**Two cautions, both load-bearing:**

1. `assist` is populated on **substitution** events too, where it means the player coming *on*. Counting "events where `related_player_id` is me" without filtering by event type reads every substitute appearance as an assist. `ASSISTED_GOAL_EVENT_TYPES` in `src/lib/football/player-stats.ts` is that filter, and it matches exactly what fantasy scoring credits (`goal`, `penalty_goal`) so the two cannot disagree about one player's total. An own goal has no assister.
2. There is a **second, different** assist number: `fixture_player_statistics.assists`, from `/fixtures/players`. It is equally real and is deliberately *not* the source for a player's career total, because it exists only for competitions with per-player coverage while goals are counted from `fixture_events` across everything synced. Mixing them would render "Goals 12 · Assists 2" where the 12 spans a season and the 2 spans the three matches that had per-player stats — two true numbers forming a false pair. The rule is one source per stat pair, stated at the point of computation.

Surfaces showing the `related_player_id` count today: the player page, the player comparison page, the transfer page's player record, and the player and comparison share cards.

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
| Per-player match stats | 120s | Same clock as the team statistics beside them, so a player line can never disagree with the team line above it |
| Coverage (`/leagues`) | 604,800s (1 week) | What a provider *supports* changes when a season rolls over, not during one — and this is the largest response on the API |
| Injuries | 21,600s (6 hours) | The one thing here that genuinely moves within a day, but never so urgently that a six-hour-old report misleads |
| Top scorers | 21,600s (6 hours) | Only moves when matches are played |
| Player season stats | 21,600s (6 hours) | Changes at most once per matchday |
