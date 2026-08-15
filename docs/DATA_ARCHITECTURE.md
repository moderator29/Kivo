# KIVO football data architecture

What's real today, end to end: where football data comes from, how it gets normalized, how it lands in Supabase, and what parts of the "live data" target architecture exist versus don't yet. Companion docs: `docs/PROVIDER_ABSTRACTION.md` (the provider interface and both implementations), `docs/API_FOOTBALL.md` (the primary provider in detail), `docs/API_QUOTA.md` (rate-limit/quota handling), `docs/CACHING_STRATEGY.md` (freshness/TTL), and `docs/LIVE_DATA.md` (Realtime distribution — a separate work stream, not duplicated here).

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
| Freshness display (`last-synced.ts`, "Last synced X ago" on public pages) | **REAL**, see `docs/CACHING_STRATEGY.md` |
| Quota-aware retry/backoff (API-Football) | **REAL**, see `docs/API_QUOTA.md` |
| Supabase Realtime distribution of already-synced updates | **REAL** (a separate work stream — see `docs/LIVE_DATA.md`) |
| Automated live worker / scheduled polling | **NOT BUILT** — `FOOTBALL_LIVE_POLLING_ENABLED` stays `false`. This is a real, separate infrastructure project (cron/scheduler, dedup under concurrent runs, provider health monitoring), intentionally out of scope for this pass — see `docs/LIVE_DATA.md`'s checklist for exactly what has to be true before the flag can flip. |
| Cross-provider entity reconciliation ("merge API-Football's Arsenal with TheSportsDB's Arsenal") | **NOT BUILT** — not attempted; see `docs/PROVIDER_ABSTRACTION.md` |
| Formal TTL-by-volatility-tier caching policy (a named, enforced system) | **NOT BUILT as a formal system** — real per-endpoint cache windows exist today, just not as a documented, enforced tiering policy. See `docs/CACHING_STRATEGY.md`. |
