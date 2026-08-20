# Caching and freshness strategy

What's real today for how long football data is cached and how "freshness" is displayed — and an honest statement of what doesn't exist yet as a formal system. Companion doc: `docs/API_QUOTA.md` (how retry/backoff protects quota on top of this).

## What actually exists: per-endpoint `fetch` cache windows

Every provider request goes through Next.js's `fetch` with an explicit `next: { revalidate: N }` window. **This is no longer the only caching layer** — since 2026-08-19 there is a database-backed response cache above it (see "The formal system" below) — but it remains real and unchanged, and the two do different jobs: this one is free and deduplicates within one serverless instance, the other costs a Postgres round trip and deduplicates across all of them. The windows are set per API-Football endpoint in `src/lib/football/providers/api-football.ts`, chosen specifically to make on-demand, per-team/per-fixture syncing survive the free tier's 100-requests/day, 10-requests/minute budget — not chosen for "freshness" as an end in itself:

| Data | Window | Constant |
|---|---|---|
| Fixtures (by date or by id) | 300s | `FIXTURE_CACHE_SECONDS` |
| Squads | 86,400s (1 day) | `SQUAD_CACHE_SECONDS` |
| Managers | 86,400s (1 day) | `MANAGER_CACHE_SECONDS` |
| Lineups | 120s | `LINEUP_CACHE_SECONDS` |
| Match events | 120s | `EVENTS_CACHE_SECONDS` |
| Fixture statistics | 120s | `STATISTICS_CACHE_SECONDS` |
| Standings | 3,600s (1 hour) | `STANDINGS_CACHE_SECONDS` |
| Transfers | 172,800s (2 days) | `TRANSFERS_CACHE_SECONDS` |

`src/lib/football/providers/thesportsdb.ts` uses its own, smaller set of windows for the endpoints it actually implements (fixtures: 300s, squads: 86,400s, standings: 3,600s) — chosen against TheSportsDB's documented ~30-requests/minute free-tier limit, same "survive the quota" reasoning, not independently re-derived from a formal policy.

**This is real, and it does the job it's chosen for** (keeps a busy admin screen from re-spending quota on an unchanged resource within the window), but it is a set of per-endpoint constants a developer picked, not an enforced, named tiering system — see "What doesn't exist" below.

## What actually exists: sync-run-based freshness display

Separately from the `fetch` cache above, public pages show "Updated X ago" via `src/lib/football/last-updated.ts`'s `getLastUpdatedAt(entityTypes)`. This is **not** derived from the `fetch` cache windows, and it's worth being precise about why:

- `NormalizedFixture.retrievedAt` (and equivalent fields) are carried on every normalized object specifically for per-row freshness, but are discarded at the sync boundary — `upsertFixture` and equivalents never write it to a per-row column.
- Instead, `getLastUpdatedAt` reads `sync_runs.last_synced_at`, written once per completed sync run (`finished_at`, effectively). Since every provider call within one sync run completes inside the same request window `retrievedAt` would have captured per-row, the two are equivalent for display purposes — this is a deliberate simplification (avoiding a new column and new provider-boundary wiring for every normalized type), not an oversight.
- Only `"success"`/`"partial"` runs count. A `"failed"` run (e.g. quota exhausted before anything was fetched) never actually refreshed what a viewer is looking at, so it doesn't get to claim freshness.

This is what powers the "Updated X ago" note on team, player, and match pages (`LastUpdatedNote`; the helper and the component were both named "…Synced…" until 2026-08-20 — a fan has no sync pipeline, only a scoreline that is current or not, see RECOMMENDATIONS.md F1) — real, working, sourced from `sync_runs`, not a cache-header inference.

## The formal system, as of 2026-08-19: resource classes

**The section that used to be here said this did not exist.** It said there was no named policy, no config object, no enforced rule, and no single source of truth to consult other than reading a provider file's constants — and that building one was "real, scoped future work, not attempted this pass". This is that work, landed.

### One place a kind of football fact declares how long it stays true

`src/lib/football/cache/resource-classes.ts` holds `RESOURCE_POLICIES`, keyed by a `ResourceClass` union. Adding a resource means adding a case to that union, and the type makes it impossible to cache something that has not declared a policy — the guardrail whose absence the old section flagged.

The classes are keyed on **the kind of fact, not the endpoint**, and that is the substantive change rather than a tidying-up. The same `/fixtures` call returns a match kicking off in an hour, a match in its 70th minute, and a match that finished in April. Cached per endpoint, all three get whichever window the developer had in mind — in practice the shortest, so KIVO re-fetched April every time it wanted the 70th minute. Three classes, three policies:

| Class | Fresh | Stale window | Why |
|---|---|---|---|
| `live_match` | 30s | 60s | The one class where old data is worse than none. A score four minutes behind is not degraded, it is wrong. |
| `upcoming_match` | 10m | 1h | Fixtures move hours in advance, not minutes. |
| `completed_match` | 6h | 2d | A result is history. Most of what anybody browses, and the largest single saving here. |
| `match_lineups` / `match_events` / `match_statistics` | 2m | 15m | Identical on purpose, so a match room can never show three views of one match that disagree. |
| `standings` | 6h | 2d | Expired by a finished match rather than by the clock — see below. |
| `squad` | 1d | 7d | Two windows a year, but a mid-season signing must not stay invisible for a week. |
| `team` / `player` / `competition` / `competition_coverage` | 7d | 30d | Change between seasons, not within one. |
| `player_season_stats` / `top_scorers` | 6h | 3d | Advance once a matchday at most. |
| `transfers` | 2d | 7d | Append-only and already historical fact. |
| `injuries` | 6h | 1d | The one slow class that genuinely moves within a day. |
| `provider_status` | 5m | 5m (none) | Carries today's spend. A stale quota number gets believed and acted on. |

Every entry carries a `rationale` sentence, and the Admin provider page prints it beside the number, so a window can be judged without opening the file.

### Two deadlines, not one — and why that is the point

Each policy declares `freshSeconds` **and** `staleSeconds`. Before `freshSeconds`, the answer is served with no question asked. Between the two, exactly one caller refreshes while everybody else is handed the old body immediately. That gap is the stale-while-revalidate behaviour, and it is where the product survives a provider outage rather than emptying out.

The stale window is deliberately **wider for slow-moving facts than for fast ones**, which is the opposite of the instinct. A four-hour-old league table is still a league table; a four-hour-old live score is a lie.

### The cache is in the database, because an in-process one is a lie at scale

`provider_response_cache` (migration 0118). The obvious implementation of "only one caller should fetch" is a module-level map of in-flight promises — three lines, and false on this platform. A serverless function shares no memory between invocations: the map is empty on every cold start, and two invocations on two instances each have their own. The deduplication it appears to provide is exactly the deduplication that does not happen during a burst, which is the only time it mattered.

So the dedupe is a **lease** in the database, taken in the same statement that reads the entry (`claim_provider_cache_entry`). Asking "is this fresh" and "may I be the one to refresh it" separately is check-then-act and lets both callers through. Leases **expire** rather than being released, so a holder killed by a serverless duration limit cannot wedge a resource class forever — the same reasoning `sync_locks` and `reap_abandoned_sync_runs` already use.

This sits **above** the per-endpoint `revalidate` windows described earlier, which stay exactly where they are. They are free and deduplicate within one instance; this one costs a Postgres round trip and deduplicates across all of them.

### Standings are refreshed by an event, not a clock

A league table is stable for days and then changes in ninety minutes. An hourly TTL spends roughly twenty-four requests a day to catch the two or three occasions a week that mattered; a daily TTL is cheap and wrong for most of Saturday evening. Neither is a good trade.

So the clock is set long and a finished match expires the entry outright (`invalidate_provider_cache`, called through `invalidateOnMatchCompletion`). Which classes are enrolled is declared by the classes themselves (`invalidatedByFinishedMatch: true`), not listed at the call site. It **expires rather than deletes**: until the new table arrives the old one is still the best answer, and deleting it would turn an 89th-minute goal into an empty screen.

`player_season_stats` is deliberately *not* enrolled, though it also changes when a match ends. A table is one small object shared by twenty clubs; season stats are one object per player, and expiring every player in a league because one match finished would turn a saving into a stampede.

### A cache miss is not permission to spend

The resource class also names its budget bucket, and `withProviderCache` reserves from the ledger **after** winning the lease and **before** running the fetcher — the only ordering that cannot spend a request the ledger does not know about. A refused reservation falls back to stale data when there is any, because a slightly old league table is a much better answer than an exhausted quota.

### Why the TTLs are in TypeScript when the budget ceilings are in SQL

A deliberate asymmetry. A budget ceiling bounds spending somebody else's money, so a caller that can choose its own has no ceiling — it belongs where only a migration can change it (migration 0094 argues this at length and it stands). A TTL is a claim about how fast football changes: application code has to branch on it, it should be unit-testable without a database, and a caller cannot abuse it — the worst a wrong TTL does is waste a request or show something slightly old.

### What is still not proven

**None of this has been exercised against a real provider.** Both new provider domains are blocked by the egress proxy this was built behind and no provider key exists in this environment, so every claim above about *request savings* is a claim about the mechanism, not a measurement of it. What has been verified: the state machine itself, exercised against the live database — a miss grants exactly one lease, a second concurrent caller is refused it, a written entry reads back as `fresh`, an invalidation moves it to `stale`, and a released lease removes the empty row. What has not: a single real provider response has ever passed through it.

## `revalidatePath` under `force-dynamic` — measured, because it was about to be deleted

`KIVO_NEXT_GEN.md` KN-28 raised a good question and reached the wrong conclusion, and the difference matters because its suggested remedy was to remove dozens of `revalidatePath` calls.

**The question**: `src/app/(app)/layout.tsx` sets `export const dynamic = "force-dynamic"` for the whole app group. If no route in the group has a cached RSC payload, there is nothing for `revalidatePath` to invalidate, and every call in every Server Action under `(app)` is inert.

**What was measured**, against a real production build on 2026-08-18: every single route in the `(app)` group is emitted as `ƒ (Dynamic) server-rendered on demand`. Not one is `○ (Static)` or `● (SSG)`. So the first half of the premise is **confirmed**: there is no server-side cache entry for any of these routes, and item 80 (pushing the dynamic boundary down so public list pages can be cached) is still genuinely open.

**But the calls are not inert**, and this is the half the item missed. `revalidatePath` called from a Server Function does two different things, and only one of them is about the server cache. From Next 16's own API reference (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`), verbatim:

> **Server Functions**: Updates the UI immediately (if viewing the affected path). Currently, it also causes all previously visited pages to refresh when navigated to again.

That second behaviour is client-side and has nothing to do with whether the route had a server cache entry. It is what makes the ordinary product loop work: post something, navigate to `/social`, and see your post — rather than being handed the copy of `/social` the client already had in memory from before the mutation. Removing these calls would not be tidying up dead code; it would ship a product where mutations do not appear until a hard reload.

**Therefore**: leave them. Item 80 remains worth doing on its own merits (a cacheable public list page is faster and cheaper), and if it ever lands, these calls become load-bearing on the server side too rather than newly necessary. The narrowing pass `RECOMMENDATIONS.md` item 81 did — from `revalidatePath("/", "layout")` to specific paths — was and remains correct: with the client-refresh behaviour above, an over-broad path invalidates more of the user's client-side navigation history than the mutation actually touched.

**What is genuinely not verifiable from here**: whether the client-refresh behaviour survives a future Next release. The doc says "Currently … This behavior is temporary and will be updated in the future to apply only to the specific path." That is a narrowing of scope, not a removal, so the calls stay correct either way — but it is the sentence to re-read on the next major upgrade.
