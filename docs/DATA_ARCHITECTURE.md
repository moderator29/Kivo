# KIVO football data architecture

What's real today, end to end: where football data comes from, how it gets normalized, how it lands in Supabase, and what parts of the "live data" target architecture exist versus don't yet. Companion docs: `docs/PROVIDER_ABSTRACTION.md` (the provider interface and both implementations), `docs/API_FOOTBALL.md` (the primary provider in detail), `docs/API_QUOTA.md` (rate-limit/quota handling), `docs/CACHING_STRATEGY.md` (freshness/TTL), and `docs/LIVE_DATA.md` (Realtime distribution — a separate work stream, not duplicated here).

## The plan gate — read this before diagnosing an empty table

**Established against the live database on 2026-08-19, not inferred.** The
account this deployment runs against is on a plan that refuses every
season-scoped endpoint. The provider's own words, recorded in
`sync_runs.error_message`:

> "Free plans do not have access to this season, try from 2022 to 2024."

API-Football signals this with **HTTP 200 and an `errors` object**, not a 4xx,
so an unguarded reader turns "the provider refused us" into "there is no
football". `providers/api-football-request.ts` catches it (`extractProviderError`)
and, since this pass, classifies it as its own `plan` error kind and rewrites
the message into an instruction with the provider's sentence kept inside it.

Which endpoints this gates is decided by one thing only — whether the request
carries a `season` parameter:

| Not season-scoped (works on any plan) | Season-scoped (subject to the plan's season window) |
|---|---|
| `/fixtures?date=`, `/fixtures?live=all`, `/fixtures?id=` | `/leagues?season=` (the coverage registry) |
| `/players/squads?team=`, `/coachs?team=` | `/teams?league=&season=` (club lists) |
| `/fixtures/{lineups,events,statistics,players}?fixture=` | `/standings?league=&season=` |
| `/transfers?player=`, `/transfers?team=` | `/injuries`, `/players/topscorers`, `/players?id=&season=` |
| `/status` | |

That table is why the live database held 705 teams and 354 fixtures and nothing
else: `/fixtures?date=` was the only season-free endpoint anything had actually
reached.

**The season is now settable** (`src/lib/football/target-season.ts`, migration
0115). Precedence: a `provider_season_target` row → `FOOTBALL_TARGET_SEASON` →
the calendar. The default stays the real current season, and every surface that
resolves an override states the year and where it came from — KIVO must never
quietly present a two-year-old season as this one. Admin → Data Health →
"Plan and season coverage" shows the plan (from `/status`), the target season,
every endpoint's status with a reason, and the refusals KIVO has actually been
given, quoted.

## Abandoned sync runs

`sync_runs` rows can be left `running` forever, and the `finally` in
`syncTodayFixtures` cannot prevent it: `finally` needs a live process, and a
serverless invocation killed at its duration limit runs none of it. The lease
in `sync_locks` already survives this because it carries an expiry; the run row
did not, so Data Health drew phantom in-progress syncs (seven of them on
2026-08-19). Migration 0116's `reap_abandoned_sync_runs` gives the run row the
same time-based expiry. It closes a stale run as `failed` with a message saying
the process ended rather than that the provider refused, and it deliberately
never writes `last_synced_at` and never invents a `records_processed` — a
reaped run's outcome is genuinely unknown.

## The pipeline, as it actually runs

```
Admin clicks a sync action (Data Health, a team/player/fixture page)
        │
        ▼
getFootballDataProvider()  ──  src/lib/football/index.ts
        │  (returns one already-selected provider instance — never both)
        ▼
ApiFootballProvider   or   TheSportsDbProvider
        │  (raw vendor JSON, vendor-specific shapes)
        ▼
Normalized* types  ──  src/lib/football/types.ts
        │  (NormalizedFixture, NormalizedTeam, NormalizedPlayer, ...
        │   identical shape regardless of which provider produced them)
        ▼
sync.ts / sync-squads.ts / sync-match-details.ts / sync-transfers.ts
        │  (idempotent upsert into Supabase, provider_mappings dedup)
        ▼
Supabase (competitions, seasons, teams, players, fixtures, fixture_events,
          lineups, standings, transfers, sync_runs, provider_mappings)
        │
        ▼
Server components read Supabase directly — no route ever calls a
provider live on a public page render (see "Nothing public calls a
provider live" below)
```

Every sync is **admin-triggered on demand**, never a cron job or background poller. That's a deliberate, standing decision (see `DECISIONS.md`), not a gap — the $0-budget free-tier quota (API-Football: 100 requests/day, ~10/min; TheSportsDB: ~30 requests/min) can't survive an automated poller without the quota-protection and dedup work `docs/LIVE_DATA.md` tracks as explicitly not-yet-built.

## Provider abstraction (the one-file swap point)

`src/lib/football/index.ts`'s `getFootballDataProvider()` is the **only** place any route, server component, or sync function is allowed to construct a concrete provider. Nothing else imports `ApiFootballProvider` or `TheSportsDbProvider` directly — confirmed by grep, not assumed. This is what makes two real, different provider implementations coexist without every caller needing to know which one is active. Full detail, including the capability matrix (what each provider can and can't do), lives in `docs/PROVIDER_ABSTRACTION.md`.

## Normalized domain models — the provider-agnostic contract

`src/lib/football/types.ts` defines `NormalizedFixture`, `NormalizedTeam`, `NormalizedPlayer`, `NormalizedManager`, `NormalizedLineups`, `NormalizedMatchEvent`, `NormalizedFixtureStatistics`, `NormalizedStandingRow`, and `NormalizedTransfer`. Every provider method returns one of these, never a raw vendor shape — the sync layer, and everything downstream of it (routes, server components, the AI Copilot's grounding context), only ever sees these types. This is what makes the TheSportsDB provider a genuine drop-in alternative rather than a parallel system with its own routes/queries: it implements the exact same `FootballDataProvider` interface and returns the exact same normalized types API-Football does.

Each normalized field's doc comment in `types.ts` states plainly when a value can be `null` and why (not reported by the provider vs. not yet fetched vs. genuinely doesn't exist for this fixture) — there is no silent "0 means unknown" convention anywhere in these types.

### Which normalized models exist, and which genuinely do not (audited 2026-08-19)

The founder named fourteen domain models that must be normalized. Audited
against `src/lib/football/types.ts`, one by one:

| Model | Status |
|---|---|
| matches | `NormalizedFixture` |
| teams | `NormalizedTeam`, `NormalizedTeamProfile` |
| players | `NormalizedPlayer` |
| competitions | **No standalone type.** Competition identity travels inside `NormalizedFixture` (`competitionProviderId`/`Name`/`Country`/`season`) and inside `NormalizedCompetitionCoverage`, which is the registry's own model and carries name, country, type and logo. Nothing downstream reads a raw vendor competition shape, so the abstraction holds; a dedicated `NormalizedCompetition` would be a refactor of `NormalizedFixture`, not a gap in provider-independence. |
| standings | `NormalizedStandingRow` |
| lineups | `NormalizedLineups`, `NormalizedTeamLineup`, `NormalizedLineupEntry` |
| events | `NormalizedMatchEvent` |
| statistics | `NormalizedFixtureStatistics`, `NormalizedFixtureTeamStatistics` |
| player ratings | **Present, contrary to expectation.** `NormalizedPlayerFixtureStatistics.providerRating` and `NormalizedPlayerSeasonStatistics.providerRating` carry the provider's own 0–10 rating. KIVO's `rating-engine.ts` computes a separate rating and the two are never mixed — the field name says whose opinion it is. |
| transfers | `NormalizedTransfer`, `NormalizedTeamTransfer` |
| coaches | `NormalizedManager` |
| news | **Genuinely absent, and deliberately not invented.** Neither configured provider has a news endpoint: API-Football publishes none, and TheSportsDB's public API has none KIVO could confirm. Adding a `NormalizedNewsItem` with no provider behind it would be a type describing data KIVO cannot obtain — an empty contract that reads as a capability. When a news source is chosen, the model comes with it. |
| injuries | `NormalizedInjury` |
| venues | **No standalone type.** Venue identity travels inside `NormalizedFixture` (`venueProviderId`, `venueName`, `venueCity`) and lands in the `venues` table via `sync.ts`'s `upsertVenue`. Same reasoning as competitions: provider-independent already, just not extracted. |

Added this pass: `NormalizedProviderPlan` — the provider's own statement about
the account (plan name, subscription state, today's request count). Null, never
a guess, from a provider that publishes no such endpoint.

## `provider_mappings` — how external IDs become KIVO IDs

Every synced entity (team, player, competition, fixture, transfer, fixture event) gets a row in `provider_mappings` linking `(provider, entity_type, provider_entity_id)` to KIVO's own internal `kivo_entity_id`. This is what lets the same real-world team have two independent provider identities (an API-Football id and, if TheSportsDB is ever used for that same competition, a separate TheSportsDb id) without KIVO needing to merge or reconcile them — each provider's sync writes its own mapping row, keyed by `provider`. There is currently no cross-provider entity-reconciliation logic (see `docs/PROVIDER_ABSTRACTION.md` for why that's a deliberately separate, larger feature, not built this pass).

## Nothing public calls a provider live

Every provider call happens inside an admin-triggered server action (`src/app/admin/data-health/actions.ts` and the per-page inline sync buttons it powers). A public page render — `/matches`, `/teams/[id]`, `/players/[id]`, Match Centre — reads Supabase directly, never a provider. This means: a provider outage or quota exhaustion never breaks a public page (it just means the data on screen doesn't get fresher until an admin syncs again), and a 429/5xx from a provider only ever surfaces on the admin-only Data Health screen, not to an ordinary visitor.

## What's real vs. not-yet-built (honest status)

| Piece | Status |
|---|---|
| Provider abstraction (interface + two real implementations) | **REAL** |
| Normalized domain models, provider-agnostic everywhere downstream | **REAL** |
| Admin-triggered sync (fixtures, squads, lineups/events/stats, standings, transfers) | **REAL** |
| `provider_mappings` dedup/identity translation | **REAL** |
| Freshness display (`last-updated.ts`, "Updated X ago" on public pages) | **REAL**, see `docs/CACHING_STRATEGY.md` |
| Quota-aware retry/backoff (API-Football) | **REAL**, see `docs/API_QUOTA.md` |
| Supabase Realtime distribution of already-synced updates | **REAL** (a separate work stream — see `docs/LIVE_DATA.md`) |
| Automated live worker / scheduled polling | **NOT BUILT** — `FOOTBALL_LIVE_POLLING_ENABLED` stays `false`. This is a real, separate infrastructure project (cron/scheduler, dedup under concurrent runs, provider health monitoring), intentionally out of scope for this pass — see `docs/LIVE_DATA.md`'s checklist for exactly what has to be true before the flag can flip. |
| Cross-provider entity reconciliation ("merge API-Football's Arsenal with TheSportsDB's Arsenal") | **NOT BUILT** — not attempted; see `docs/PROVIDER_ABSTRACTION.md` |
| Formal TTL-by-volatility-tier caching policy (a named, enforced system) | **NOT BUILT as a formal system** — real per-endpoint cache windows exist today, just not as a documented, enforced tiering policy. See `docs/CACHING_STRATEGY.md`. |
