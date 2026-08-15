# Live data architecture

Target architecture (per the founder's 2026-08-15 directive):

```
API-Football
    v
KIVO Live Worker
    v
Normalize
    v
Supabase
    v
Supabase Realtime
    v
All connected users
```

This document describes what's **real today** versus what's still deliberately unbuilt. Do not read the diagram above as a description of shipped infrastructure — see the status table below.

## Status

| Piece | Status | Notes |
|---|---|---|
| Upstream fetch + normalize | REAL, admin-triggered only | `syncTodayFixtures` (called by both the "Sync now" button and `triggerLiveScoresRefresh`) fetches, normalizes, and writes to `fixtures`/`fixture_events`. No automated scheduler calls it — a human clicks a button in `/admin/data-health` or `/live`. |
| Automated live worker (cron/scheduled) | **NOT BUILT** | Deliberately. Building an automated poller before quota protection, dedup, and provider health monitoring are all proven out risks silently exhausting the free-tier API-Football quota. `FOOTBALL_LIVE_POLLING_ENABLED` stays `false` until this exists and is verified. |
| Supabase Realtime distribution | REAL, shipped 2026-08-15 | Migration `0038_realtime_fixture_distribution` adds `fixtures` and `fixture_events` to the `supabase_realtime` publication. `src/hooks/use-realtime-fixtures.ts` subscribes to `postgres_changes` UPDATE events on `fixtures`, filtered client-side to the ids currently on screen. Wired into `/live` (`LiveFixtureList`) and Match Centre's score header (`MatchScoreDisplay`). |
| Quota protection / dedup / retry-backoff | REAL, predates this doc | `src/lib/football/providers/api-football-request.ts` — parses `x-ratelimit-requests-remaining`, one jittered retry on 5xx only, never retries 4xx. See `docs/API_QUOTA.md`. |
| Provider health monitoring | PARTIAL | Quota numbers exist in the request layer; not yet fully surfaced as a dedicated Admin panel (see `docs/API_QUOTA.md` for current state). |

## What "Realtime distribution is real" actually means today

Because there's no automated worker yet, the practical effect right now is: when an admin clicks "Sync now" (or any other action that writes fresh scores to `fixtures`), **every browser currently viewing `/live` or that fixture's Match Centre page updates instantly** — no page refresh, no client-side polling of any kind. That's the full "one upstream update -> many users" pattern from the directive, just with a human as the trigger instead of a cron job for now.

This is a genuine, useful improvement on its own (an admin syncing mid-match now visibly updates everyone watching), and it means the automated-worker piece, whenever it's built, plugs into infrastructure that's already proven to fan out correctly — the worker only needs to call the same `syncTodayFixtures` path that already writes to Realtime-enabled tables. No frontend changes will be needed when that day comes.

## Before `FOOTBALL_LIVE_POLLING_ENABLED` can flip to `true`

Per the founder's own directive, all of the following must be true, verified, not just built:

- [x] Realtime distribution (this doc)
- [x] Quota protection, retry/backoff (`api-football-request.ts`, predates this pass)
- [ ] A real server-side scheduled worker (cron, Vercel Cron, or equivalent) — not built
- [ ] Provider health monitoring surfaced in Admin — partial
- [ ] Dedup logic proven under concurrent/overlapping worker runs — not built (today's single admin-triggered sync has no concurrency to dedupe against)
- [ ] Load-tested with the Realtime channel under multiple simultaneous subscribers — not tested

Do not flip the flag until every box above is checked and verified, not assumed.
