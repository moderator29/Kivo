# Caching and freshness strategy

What's real today for how long football data is cached and how "freshness" is displayed — and an honest statement of what doesn't exist yet as a formal system. Companion doc: `docs/API_QUOTA.md` (how retry/backoff protects quota on top of this).

## What actually exists: per-endpoint `fetch` cache windows

Every provider request goes through Next.js's `fetch` with an explicit `next: { revalidate: N }` window — there is no other caching layer (no Redis, no in-memory LRU, no CDN-level football-data cache) anywhere in the football data path. The windows are set per API-Football endpoint in `src/lib/football/providers/api-football.ts`, chosen specifically to make on-demand, per-team/per-fixture syncing survive the free tier's 100-requests/day, 10-requests/minute budget — not chosen for "freshness" as an end in itself:

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

Separately from the `fetch` cache above, public pages show "Last synced X ago" via `src/lib/football/last-synced.ts`'s `getLastSyncedAt(entityTypes)`. This is **not** derived from the `fetch` cache windows, and it's worth being precise about why:

- `NormalizedFixture.retrievedAt` (and equivalent fields) are carried on every normalized object specifically for per-row freshness, but are discarded at the sync boundary — `upsertFixture` and equivalents never write it to a per-row column.
- Instead, `getLastSyncedAt` reads `sync_runs.last_synced_at`, written once per completed sync run (`finished_at`, effectively). Since every provider call within one sync run completes inside the same request window `retrievedAt` would have captured per-row, the two are equivalent for display purposes — this is a deliberate simplification (avoiding a new column and new provider-boundary wiring for every normalized type), not an oversight.
- Only `"success"`/`"partial"` runs count. A `"failed"` run (e.g. quota exhausted before anything was fetched) never actually refreshed what a viewer is looking at, so it doesn't get to claim freshness.

This is what powers the "Last synced" note on team, player, and match pages — real, working, sourced from `sync_runs`, not a cache-header inference.

## What doesn't exist: a formal TTL-by-volatility-tier system

There is no single named policy, config object, or enforced rule that says "volatility tier X gets TTL Y, and every new data type must declare its tier before shipping." What exists instead is a set of per-endpoint constants (the table above) that a developer chose per data type, following an implicit "how often does this actually change, and what does the quota afford" reasoning captured only in code comments next to each constant — not codified as a reusable, generically-applicable framework.

Concretely, this means:

- There's no single source of truth to consult ("what's the TTL for X") other than reading the relevant provider file's constants directly.
- There's no enforcement that a newly-added endpoint must pick a tier from a defined set — a future addition could pick an arbitrary number with no guardrail.
- The two providers' cache windows aren't shared/unified — API-Football's and TheSportsDB's constants are defined independently, even for conceptually the same data type (fixtures, squads, standings), because each was tuned against that provider's own quota limit rather than a shared abstraction.

Building a formal system (a `VOLATILITY_TIER` enum, a lookup table, enforced at the type level) is real, scoped future work — not attempted this pass, and not currently blocking anything, since the ad hoc constants do correctly protect quota today. Flagging honestly rather than describing the current constants as more systematic than they are.

## `revalidatePath` under `force-dynamic` — measured, because it was about to be deleted

`KIVO_NEXT_GEN.md` KN-28 raised a good question and reached the wrong conclusion, and the difference matters because its suggested remedy was to remove dozens of `revalidatePath` calls.

**The question**: `src/app/(app)/layout.tsx` sets `export const dynamic = "force-dynamic"` for the whole app group. If no route in the group has a cached RSC payload, there is nothing for `revalidatePath` to invalidate, and every call in every Server Action under `(app)` is inert.

**What was measured**, against a real production build on 2026-08-18: every single route in the `(app)` group is emitted as `ƒ (Dynamic) server-rendered on demand`. Not one is `○ (Static)` or `● (SSG)`. So the first half of the premise is **confirmed**: there is no server-side cache entry for any of these routes, and item 80 (pushing the dynamic boundary down so public list pages can be cached) is still genuinely open.

**But the calls are not inert**, and this is the half the item missed. `revalidatePath` called from a Server Function does two different things, and only one of them is about the server cache. From Next 16's own API reference (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidatePath.md`), verbatim:

> **Server Functions**: Updates the UI immediately (if viewing the affected path). Currently, it also causes all previously visited pages to refresh when navigated to again.

That second behaviour is client-side and has nothing to do with whether the route had a server cache entry. It is what makes the ordinary product loop work: post something, navigate to `/social`, and see your post — rather than being handed the copy of `/social` the client already had in memory from before the mutation. Removing these calls would not be tidying up dead code; it would ship a product where mutations do not appear until a hard reload.

**Therefore**: leave them. Item 80 remains worth doing on its own merits (a cacheable public list page is faster and cheaper), and if it ever lands, these calls become load-bearing on the server side too rather than newly necessary. The narrowing pass `RECOMMENDATIONS.md` item 81 did — from `revalidatePath("/", "layout")` to specific paths — was and remains correct: with the client-refresh behaviour above, an over-broad path invalidates more of the user's client-side navigation history than the mutation actually touched.

**What is genuinely not verifiable from here**: whether the client-refresh behaviour survives a future Next release. The doc says "Currently … This behavior is temporary and will be updated in the future to apply only to the specific path." That is a narrowing of scope, not a removal, so the calls stay correct either way — but it is the sentence to re-read on the next major upgrade.
