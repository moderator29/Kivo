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

This document describes what's **real today** versus what's still deliberately unbuilt, or genuinely can't be verified from this sandbox. Do not read the diagram above as a description of shipped infrastructure — see the status table below.

## Status

| Piece | Status | Notes |
|---|---|---|
| Upstream fetch + normalize | REAL | `syncTodayFixtures` fetches, normalizes, and writes to `fixtures`/`fixture_events`. Callable by an admin (Data Health's "Sync now", `triggerLiveScoresRefresh`) or, since 2026-08-18, by the automated cron worker below — same function either way, `triggerSource` just tags which. |
| Automated live worker (cron/scheduled) | **REAL, built 2026-08-18** — genuine production firing NOT verifiable from this sandbox | `src/app/api/cron/sync-live/route.ts`, scheduled every minute via the `crons` array in `vercel.json`. See "The automated worker, in detail" below for exactly what it checks before spending a provider call. **What's verified**: the route's own logic (auth check, each guard, the real DB queries, `syncTodayFixtures` integration) — read and reasoned through directly, and it type-checks/lints/builds clean. **What's NOT verified, and can't be from here**: whether Vercel's real Cron infrastructure actually invokes this route on schedule once deployed. This sandbox has no way to trigger a real scheduled Vercel Cron firing or observe one happening — that can only be confirmed after a real deployment, by checking the Cron Jobs tab in the Vercel dashboard and/or watching Data Health's new "Automated worker" section for check-ins. |
| Supabase Realtime distribution | REAL, shipped 2026-08-15 | Migration `0038_realtime_fixture_distribution` adds `fixtures` and `fixture_events` to the `supabase_realtime` publication. `src/hooks/use-realtime-fixtures.ts` subscribes to `postgres_changes` UPDATE events on `fixtures`, filtered client-side to the ids currently on screen. Wired into `/live` (`LiveFixtureList`) and Match Centre's score header (`MatchScoreDisplay`). |
| Match Room live chat | REAL, shipped 2026-08-18 | A second, differently-behaved Realtime consumer of the same `posts` publication `0042_realtime_posts` already added for `/social`'s "new posts" pill. `src/hooks/use-realtime-room-posts.ts` subscribes to `postgres_changes` INSERT on `posts`, server-side filtered to one fixture (`fixture_id=eq.<id>`), and auto-prepends every arrival — a real user's post or a system goal/red-card announcement (RECOMMENDATIONS item 254, `src/lib/football/match-room-system-posts.ts`) — with no click required, unlike `/social`'s deliberate click-to-reveal pill. See the hook's own doc comment, and the 2026-08-18 DECISIONS.md entry, for why that divergence from the feed's pattern was checked against Room specifically rather than assumed. |
| Quota protection / retry-backoff | REAL, predates this doc | `src/lib/football/providers/api-football-request.ts` — parses `x-ratelimit-requests-remaining`, one jittered retry on 5xx only, never retries 4xx. See `docs/API_QUOTA.md`. |
| Quota-aware throttling (refuse to spend quota below a safety floor) | **REAL, built 2026-08-18** | The cron worker reads the most recent known `provider_quota_remaining` (same `sync_runs` query Data Health's own "requests left today" pill uses) before running, and skips — logging why — when it's at or below a floor of 10 remaining requests. See the worker's own doc comment for the full reasoning on that number. This is genuinely new: `docs/API_QUOTA.md`'s "What doesn't exist" section previously and correctly said "no proactive quota-based throttling... nothing pre-emptively blocks a sync from being attempted when quota is low" — that gap is what this closes. |
| Dedup (no overlapping worker runs) | **REAL, built 2026-08-18** | Before doing anything else, the worker checks for an existing `sync_runs` row with `status = 'running'`, `trigger_source = 'cron'`, `entity_type = 'fixture'`, started within the last 2 minutes — and skips if one is found rather than risking a concurrent `syncTodayFixtures` call. This is the prerequisite the checklist below used to flag as entirely missing ("today's single admin-triggered sync has no concurrency to dedupe against") — it's now real, though see the checklist for what "proven" still requires. |
| Provider health monitoring | IMPROVED, still not a fully dedicated panel | Admin → Data Health now has a dedicated "Automated worker" section (distinct from "Recent sync runs", which is manual-only) showing the worker's last 8 decisions — including every no-op and why — plus a stale/not-checking-in indicator if its last known firing is more than 5 minutes old. Quota numbers still live inline on sync run rows rather than a separate quota-history chart; see `docs/API_QUOTA.md` for what still doesn't exist there. |

## The automated worker, in detail

`src/app/api/cron/sync-live/route.ts` is fired by Vercel Cron every minute (`vercel.json`'s `crons` array, schedule `* * * * *` — Vercel's documented minimum interval, and the exact expression Vercel's own docs use for their "every minute" example). The schedule itself is deliberately dumb and unconditional; every bit of "is this actually worth a real provider call" judgment happens inside the route, in this order, any step capable of ending the request as a logged no-op:

1. **Auth.** Rejects anything without a matching `Authorization: Bearer $CRON_SECRET` header — see `ENVIRONMENT.md`'s "Automated live-sync worker" section. `CRON_SECRET` was previously reserved/unused; this is that reservation becoming real.
2. **`FOOTBALL_LIVE_POLLING_ENABLED`.** The real, standing safety gate — unchanged, still `false`/unset by default, still never flipped by code. While off, every one of these once-a-minute invocations is a same-millisecond no-op that writes one lightweight `sync_runs` row (`status: 'skipped'`) and touches nothing else.
3. **A real provider must be configured** (`API_FOOTBALL_KEY`) — mirrors the same guard the manual sync actions already use.
4. **Dedup** — see the Status table above.
5. **Quota floor** — see the Status table above.
6. **Is anything actually live or imminent?** Queries already-synced `fixtures` for `status IN ('live', 'halftime')`, or `status = 'scheduled'` with `kickoff_at` within the next 10 minutes (and not more than 3 hours in the past, so a fixture the provider never flipped out of `'scheduled'` can't force a provider call every single minute forever). Nothing found -> logged no-op, zero quota spent.

Only if every one of those passes does the worker call `syncTodayFixtures("cron")` — the exact same function "Sync now" calls, just tagged with `trigger_source: 'cron'` (migration 0044) so Data Health can tell the two apart. At most one real provider request (`getFixturesByDate`) is spent per invocation that gets this far, and the schedule's own 1-per-minute ceiling stays well under API-Football's separate 10-requests/minute limit (`docs/API_FOOTBALL.md`) even in the busiest case.

## What "Realtime distribution is real" actually means today

When anything writes a fresh score/status to `fixtures` — an admin clicking "Sync now", or (now) the automated worker's own `syncTodayFixtures` call — **every browser currently viewing `/live` or that fixture's Match Centre page updates instantly**, no page refresh, no client-side polling of any kind. That's the full "one upstream update -> many users" pattern from the directive. Until `FOOTBALL_LIVE_POLLING_ENABLED` is flipped, the worker's own calls stay no-ops, so in practice this is still driven by admin clicks alone — but the fan-out path itself needed zero changes to also serve the worker's writes the moment the flag does flip, because the worker calls the exact same `syncTodayFixtures` path that already writes to these Realtime-enabled tables.

## Before `FOOTBALL_LIVE_POLLING_ENABLED` can flip to `true`

Per the founder's own directive, all of the following must be true, verified, not just built:

- [x] Realtime distribution (this doc)
- [x] Quota protection, retry/backoff (`api-football-request.ts`, predates this pass)
- [x] A real server-side scheduled worker (Vercel Cron) — built 2026-08-18, `src/app/api/cron/sync-live/route.ts`. **Caveat**: its logic is verified; a real, observed production firing is not (see the Status table above and "What still can't be verified" below).
- [x] Dedup logic — built 2026-08-18 (see above). **Caveat**: exercised by reading/reasoning and by the type/lint/build/test suite, not by an actual concurrent production invocation — see below.
- [x] Quota-aware throttling — built 2026-08-18 (see above).
- [ ] Provider health monitoring surfaced in Admin — improved (dedicated "Automated worker" section), still not a fully separate quota-history panel.
- [ ] Load-tested with the Realtime channel under multiple simultaneous subscribers — not tested.
- [ ] **A real, observed Vercel Cron firing in production** — not verified, and structurally can't be from this sandbox (see below). This is new to the checklist, not an oversight in the original: the worker didn't exist yet to raise the question.

Do not flip the flag until every box above is checked and verified, not assumed.

## What genuinely can't be verified from this sandbox

Said plainly, once, here, rather than implied: this environment has no way to deploy to Vercel, no way to wait for a real minute to tick over on Vercel's own scheduler, and no way to inspect Vercel's Cron Jobs dashboard. Everything above marked "built" was verified by reading the actual code paths, by `npx tsc --noEmit` / `npx eslint .` / `npm run build` / `npm test` all passing clean, and — for the DB-facing pieces (the `skipped` status, the `trigger_source` column, migration 0044) — by applying the real migration against the live Supabase project and re-generating types against it, not by guessing at a schema. None of that is the same as watching a real `x-vercel-cron-schedule`-bearing request land on this route in production. **The first real signal that this works end-to-end is Data Health's "Automated worker" section showing recent check-ins after a real deploy** — if it says "Not checking in" more than a few minutes after deploying with the Cron Job configured, something about the Vercel-side wiring (not the application logic) needs attention.
