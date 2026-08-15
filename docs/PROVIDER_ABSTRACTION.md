# Football data provider abstraction

The `FootballDataProvider` interface (`src/lib/football/types.ts`) and its real implementations: `ApiFootballProvider` (primary/default) and `TheSportsDbProvider` (config-selectable alternative, added 2026-08-15 when Sportmonks was removed — see `DECISIONS.md`). A development-only `MockFootballProvider` also implements the interface so UI can be built without spending either real provider's quota; it never runs in production (see `src/lib/football/index.ts`'s `NODE_ENV` guard).

## The interface

```ts
interface FootballDataProvider {
  readonly name: string;
  getQuotaRemaining(): number | null;
  getFixturesByDate(date: string): Promise<NormalizedFixture[]>;
  getFixtureById(providerId: string): Promise<NormalizedFixture | null>;
  getStandings(leagueProviderId: string, season: number): Promise<NormalizedStandingRow[]>;
  getSquad(teamProviderId: string): Promise<NormalizedPlayer[]>;
  getManager(teamProviderId: string): Promise<NormalizedManager | null>;
  getLineups(fixtureProviderId: string): Promise<NormalizedLineups | null>;
  getMatchEvents(fixtureProviderId: string): Promise<NormalizedMatchEvent[]>;
  getFixtureStatistics(fixtureProviderId: string): Promise<NormalizedFixtureStatistics | null>;
  getPlayerTransfers(playerProviderId: string): Promise<NormalizedTransfer[]>;
}
```

Every method returns a provider-agnostic `Normalized*` type (`src/lib/football/types.ts`) — no caller downstream of a provider ever sees a raw vendor JSON shape.

## Selecting a provider

`src/lib/football/index.ts`'s `getFootballDataProvider()` is the single entry point. Selection logic:

1. `FOOTBALL_DATA_PROVIDER=thesportsdb` **and** `THE_SPORTS_DB_API_KEY` set → `TheSportsDbProvider`.
2. Otherwise, `API_FOOTBALL_KEY` set → `ApiFootballProvider` (this is the default path — `FOOTBALL_DATA_PROVIDER` unset or any value other than `thesportsdb` lands here too).
3. Otherwise, non-production → dev-only `MockFootballProvider`.
4. Otherwise (production, nothing configured) → throws.

If `FOOTBALL_DATA_PROVIDER=thesportsdb` is set but `THE_SPORTS_DB_API_KEY` is not, the app logs an error and falls back to API-Football (if configured) rather than silently doing nothing or crashing — a misconfigured provider selection degrades loudly, not silently.

**Why a single switch instead of automatic failover between the two**: this codebase has no cross-provider entity-reconciliation logic — `provider_mappings` is keyed per-provider (`provider`, `entity_type`, `provider_entity_id`), so "the same real team as seen by two different providers" are two independent, unlinked rows today. Building real failover would require deciding how to merge those identities, which is a genuinely separate, larger feature than what this pass scoped. A plain env-var switch is an honest reflection of what exists: one active provider at a time, chosen deliberately by whoever deploys the app, not two providers racing or silently substituting for each other.

**API-Football remains primary** per the founder's own standing directive (see `DECISIONS.md`'s original 2026-08-14 provider decision). TheSportsDB is additive/future-optional.

## Capability matrix — what each provider actually supports

| Method | `ApiFootballProvider` | `TheSportsDbProvider` |
|---|---|---|
| `getFixturesByDate` | Real (`/fixtures?date=`) | Real (`/eventsday.php?d=&s=Soccer`) |
| `getFixtureById` | Real (`/fixtures?id=`) | Real (`/lookupevent.php?id=`) |
| `getStandings` | Real (`/standings`) | Real, but free tier is documented as restricted to a set of "featured" soccer leagues (`/lookuptable.php`) — a non-featured league returns an honest empty array, not an error |
| `getSquad` | Real, but no date of birth / nationality on the free tier's squads endpoint (a per-player call would be needed and isn't made, to protect quota) | Real, and *does* include date of birth / nationality / position / photo (`/lookup_all_players.php`) — a genuine capability TheSportsDB has that API-Football's free squads endpoint doesn't |
| `getManager` | Real (`/coachs?team=`) | **Not supported** — no confirmed dedicated current-manager endpoint in TheSportsDB's catalog; throws |
| `getLineups` | Real (`/fixtures/lineups`) | **Not supported** — free-tier response shape not confirmed with enough confidence to ship; throws |
| `getMatchEvents` | Real (`/fixtures/events`) | **Not supported** — timeline endpoint's shape/free-tier availability not confirmed; throws |
| `getFixtureStatistics` | Real (`/fixtures/statistics`) | **Not supported** — stats endpoint's shape/free-tier availability not confirmed; throws |
| `getPlayerTransfers` | Real (`/transfers?player=`), confirmed-only, no rumour tier | **Not supported** — TheSportsDB's public API has no transfer-history endpoint at all |
| `getQuotaRemaining` | Real (`x-ratelimit-requests-remaining` response header) | Always `null` — TheSportsDB sends no quota header on any response |

"Not supported" methods throw a clear, provider-named `Error` (e.g. `"TheSportsDbProvider.getLineups: not supported by this provider..."`) rather than returning an empty result that could be misread as "this fixture genuinely has no lineup" — a thrown error and an honest empty result mean different things, and callers should be able to tell them apart. See `src/lib/football/providers/thesportsdb.ts`'s per-method doc comments for the exact reasoning and sourcing behind each "not supported" call.

## Why TheSportsDB's shape wasn't guessed at for the unsupported methods

This build environment's outbound network access to `thesportsdb.com` itself is blocked, so the provider was built by cross-referencing several independent, mutually-consistent public sources (a long-standing open-source Python client's endpoint catalog, community documentation threads, search-indexed excerpts of TheSportsDB's own docs) rather than reading `thesportsdb.com/documentation` directly. Where those sources converged confidently — endpoint paths, the overall str/int-prefixed field-naming convention, the URL-path auth mechanism — the implementation trusts them. Where they didn't converge, or where free-tier availability itself was in question (lineups, per-fixture stats, event timelines), the provider throws instead of shipping a normalizer against a guessed shape. See `src/lib/football/providers/thesportsdb.ts`'s top doc comment for the full sourcing note, and `DECISIONS.md`'s 2026-08-15 "Sportmonks removed entirely" entry for the decision record.

## Request orchestration

Both real providers follow the same retry/backoff policy, deliberately kept identical rather than reinvented per provider:

- One real attempt, one jittered retry (`250ms + random(0-250ms)`), never more.
- A retry happens **only** for a network error or a 5xx response.
- A 429 (rate limited) or any other 4xx **never** retries — it throws immediately, since retrying either burns more of an already-exhausted quota (429) or won't succeed differently on a second try (bad key, bad params).

`src/lib/football/providers/api-football-request.ts` implements this for API-Football (and additionally parses the `x-ratelimit-requests-remaining` header). `src/lib/football/providers/thesportsdb-request.ts` mirrors the same classify/retry/backoff shape for TheSportsDB — it imports `retryDelayMs` directly from the API-Football module rather than redefining jitter timing, and has no quota header to parse (TheSportsDB doesn't send one). See `docs/API_QUOTA.md` for the full quota story.
