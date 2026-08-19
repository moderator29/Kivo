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
| Automated live worker (cron/scheduled) | **Route built and real; NOT currently scheduled** — `vercel.json`'s cron entry removed 2026-08-18 (Hobby plan blocks a sub-daily schedule; see below) | `src/app/api/cron/sync-live/route.ts`. See "The automated worker, in detail" below for exactly what it checks before spending a provider call. **What's verified**: the route's own logic (auth check, each guard, the real DB queries, `syncTodayFixtures` integration) — read and reasoned through directly, and it type-checks/lints/builds clean. **What's NOT verified, and can't be from here**: whether Vercel's real Cron infrastructure actually invokes this route on schedule once deployed *and once re-added to `vercel.json` on a paid plan*. This sandbox has no way to trigger a real scheduled Vercel Cron firing or observe one happening — that can only be confirmed after a real deployment, by checking the Cron Jobs tab in the Vercel dashboard and/or watching Data Health's new "Automated worker" section for check-ins. |

**2026-08-18 update (superseded the same evening — see the next section).** The `crons` array was pulled from `vercel.json` entirely. Vercel's Hobby (free) plan rejects any deployment with a cron schedule more frequent than once a day — this route's `* * * * *` (once-a-minute) entry made every deploy fail outright on a free account.

---

## How football data actually arrives now (2026-08-18, founder instruction)

The founder's instruction was "Make it automatic — no need for triggering now". Until that evening, the only thing that had ever asked a provider for data was an admin clicking a button, which is why the database was empty and every football surface rendered its honest empty state.

There are now **three** ways data arrives, and they are genuinely different. Read the last column before describing any of this to anyone.

| Layer | Cadence | Needs from the founder | What it actually keeps fresh |
|---|---|---|---|
| **On-demand freshness** — `src/lib/football/auto-sync.ts` | Whenever somebody loads `/home`, `/matches` or `/live` and the data is already stale | **Nothing.** Runs on the deployment that already exists, with the `API_FOOTBALL_KEY` already set | Everything, eventually. But only for the *next* visitor after a gap — and on a quiet site, nothing at all |
| **Daily baseline** — `/api/cron/sync-daily` | Once a day | Six lines pasted into `vercel.json` — the route is built and deployed, only the schedule is missing. See `ENVIRONMENT.md` | Today's fixtures, and the clubs/competitions/venues they create. Plus up to five league tables, least-recently-refreshed first. **Never a live scoreline** |
| **Once-a-minute worker** — `/api/cron/sync-live` | Every minute | Two Supabase Vault secrets **and** `FOOTBALL_LIVE_POLLING_ENABLED=true` | Live scores, properly. This is the only row that is live scores |

### The thing not to over-hear

**On-demand freshness is not live scores.** It refreshes when somebody looks at a page whose data is already stale, which means the person who triggers the refresh sees the old data and the next person sees the new data. Nobody watching a single match page gets a ticking scoreline from it. That needs the third row.

### Why on-demand is bounded the way it is

Four guards, each preventing a failure that is real on a 100-request-a-day free tier:

- **`after()`, never inline.** The provider call happens once the response has been sent, so a slow or dead vendor can never delay a render or break a page.
- **A staleness threshold per surface** — 3 minutes for `/live`, 15 for `/matches` and `/home`, 180 for reference pages. A league table is not worth what a live scoreline is worth.
- **A three-minute cooldown counted on *attempts*, not successes.** This is the guard that actually protects the quota: without it, a *failing* sync leaves the data exactly as stale as it found it, so every subsequent page view would try again and a hundred page views would spend the entire daily budget on the same failure.
- **The sync lease** (migration `0056`) and **the quota floor** — ten simultaneous page loads produce one sync, and automation stops spending at the same threshold that turns Data Health's "requests left today" pill amber, so a human debugging with "Sync now" always has room.

### Why the daily cron only refreshes five league tables

Standings are a separate provider call per competition-season. With `FOOTBALL_SYNC_COMPETITION_IDS` unset, a day's fixtures can span fifty competitions, and one call each would spend half the daily budget before lunch. Five a day, least-recently-refreshed first, fills every table in within days and then keeps them all rolling — the right trade for data that changes at most once a matchday.

### Two rules that were not bent

- **`FOOTBALL_LIVE_POLLING_ENABLED` is only ever read, never written from code.** It is the founder's protection against a once-a-minute worker draining a free tier. The daily route skips consulting it because one request a day cannot drain anything — a different question from the one the flag asks — and the on-demand path never touches it either.
- **`vercel.json` was deliberately not edited by this session.** Deployment configuration is the founder's, and a `vercel.json` that fails validation blocks every deploy — which cost hours earlier the same day. The exact block to paste is in `ENVIRONMENT.md`: `0 5 * * *` (daily, which Hobby accepts) against the bare path `/api/cron/sync-daily` (no query string, because Vercel's cron documentation only ever shows a bare path — which is why the daily behaviour has its own route rather than a `?mode=` parameter).

`sync_runs.trigger_source` now records `manual` / `cron` / `auto` / `daily` (migration `0070`), so Data Health can tell four very different quota profiles apart.
| Supabase Realtime distribution | REAL, shipped 2026-08-15 | Migration `0038_realtime_fixture_distribution` adds `fixtures` and `fixture_events` to the `supabase_realtime` publication. `src/hooks/use-realtime-fixtures.ts` subscribes to `postgres_changes` UPDATE events on `fixtures`, filtered client-side to the ids currently on screen. Wired into `/live` (`LiveFixtureList`) and Match Centre's score header (`MatchScoreDisplay`). `fixture_events` had been in that publication since the same migration with nothing subscribed to it — so a goal moved the score in the header while the timeline underneath still showed the match as it stood at page load. `src/hooks/use-realtime-fixture-events.ts` (shipped 2026-08-19) closes that: INSERT, UPDATE and DELETE, filtered server-side by `fixture_id` except for DELETE (a delete payload carries only the primary key, so there is no `fixture_id` to filter on). UPDATE and DELETE are not optional here — a goal reassigned to a different scorer, or taken away by VAR, has to leave the timeline or the screen keeps crediting a goal the score no longer shows. Subscribed only while the fixture is scheduled or live. |
| Match Room live chat | REAL, shipped 2026-08-18 | A second, differently-behaved Realtime consumer of the same `posts` publication `0042_realtime_posts` already added for `/social`'s "new posts" pill. `src/hooks/use-realtime-room-posts.ts` subscribes to `postgres_changes` INSERT on `posts`, server-side filtered to one fixture (`fixture_id=eq.<id>`), and auto-prepends every arrival — a real user's post or a system goal/red-card announcement (RECOMMENDATIONS item 254, `src/lib/football/match-room-system-posts.ts`) — with no click required, unlike `/social`'s deliberate click-to-reveal pill. See the hook's own doc comment, and the 2026-08-18 DECISIONS.md entry, for why that divergence from the feed's pattern was checked against Room specifically rather than assumed. |
| Quota protection / retry-backoff | REAL, predates this doc | `src/lib/football/providers/api-football-request.ts` — parses `x-ratelimit-requests-remaining`, one jittered retry on 5xx only, never retries 4xx. See `docs/API_QUOTA.md`. |
| Quota-aware throttling (refuse to spend quota below a safety floor) | **REAL, built 2026-08-18** | The cron worker reads the most recent known `provider_quota_remaining` (same `sync_runs` query Data Health's own "requests left today" pill uses) before running, and skips — logging why — when it's at or below a floor of 10 remaining requests. See the worker's own doc comment for the full reasoning on that number. This is genuinely new: `docs/API_QUOTA.md`'s "What doesn't exist" section previously and correctly said "no proactive quota-based throttling... nothing pre-emptively blocks a sync from being attempted when quota is low" — that gap is what this closes. |
| Dedup (no overlapping worker runs) | **REAL, built 2026-08-18** | Before doing anything else, the worker checks for an existing `sync_runs` row with `status = 'running'`, `trigger_source = 'cron'`, `entity_type = 'fixture'`, started within the last 2 minutes — and skips if one is found rather than risking a concurrent `syncTodayFixtures` call. This is the prerequisite the checklist below used to flag as entirely missing ("today's single admin-triggered sync has no concurrency to dedupe against") — it's now real, though see the checklist for what "proven" still requires. |
| Provider health monitoring | IMPROVED, still not a fully dedicated panel | Admin → Data Health now has a dedicated "Automated worker" section (distinct from "Recent sync runs", which is manual-only) showing the worker's last 8 decisions — including every no-op and why — plus a stale/not-checking-in indicator if its last known firing is more than 5 minutes old. Quota numbers still live inline on sync run rows rather than a separate quota-history chart; see `docs/API_QUOTA.md` for what still doesn't exist there. |

## The automated worker, in detail

`src/app/api/cron/sync-live/route.ts` is *designed* to be fired by Vercel Cron every minute (`* * * * *` — Vercel's documented minimum interval, and the exact expression Vercel's own docs use for their "every minute" example) — as of 2026-08-18 that entry is not present in `vercel.json` (see the status table above), so nothing currently invokes this route on a schedule. The rest of this section describes the route's own logic, which is unaffected either way. The schedule itself, once wired back up, is deliberately dumb and unconditional; every bit of "is this actually worth a real provider call" judgment happens inside the route, in this order, any step capable of ending the request as a logged no-op:

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
