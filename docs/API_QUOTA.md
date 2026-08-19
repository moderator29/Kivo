# API quota and rate-limit handling

What's real today for tracking and protecting provider request quota — confirmed against the actual code, not aspirational. Companion doc: `docs/CACHING_STRATEGY.md` (how caching/freshness reduces the *need* to spend quota in the first place).

## Where quota tracking happens

`src/lib/football/providers/api-football-request.ts` — real, working, predates this pass (RECOMMENDATIONS.md items 53-55):

- **Quota parsing** (`parseQuotaRemaining`): every API-Football response's `x-ratelimit-requests-remaining` header is read defensively — a missing or non-numeric header degrades to `null` ("unknown"), never a crash or a fabricated number.
- **Error classification** (`classifyHttpError` / `ApiFootballErrorKind`): a 429 (quota exhausted), a 403 (bad key), a 5xx, and any other 4xx are distinguished, so an admin sees an accurate reason instead of one generic "request failed" message.
- **Retry policy** (`isRetryable`, `requestWithRetry`): exactly one jittered retry (`250ms + random(0-250ms)` backoff), and **only** for a network error or a 5xx response. A 429 is **never** retried — that would burn more of an already-exhausted daily quota. Other 4xx (bad key, bad params) aren't retried either, since a second identical request won't succeed differently.

`ApiFootballProvider.getQuotaRemaining()` holds the most recent quota reading seen on **any** response from that provider instance — success or failure, since the header is sent either way — and is `null` until the first request completes.

TheSportsDB sends no quota/rate-limit header of any kind on any response (confirmed across every source cross-referenced while building `docs/PROVIDER_ABSTRACTION.md`'s TheSportsDB entry) — `TheSportsDbProvider.getQuotaRemaining()` always returns `null`, honestly, not an estimate. `src/lib/football/providers/thesportsdb-request.ts` mirrors API-Football's retry/backoff policy exactly (same MAX_ATTEMPTS, same jitter, same 429-never-retries rule) even though there's no quota header to parse — the retry discipline matters independent of whether quota is observable.

## Where the number gets persisted

Every sync function (`sync.ts`, `sync-squads.ts`, `sync-match-details.ts`, `sync-transfers.ts`) writes `provider.getQuotaRemaining()` onto its `sync_runs` row as `provider_quota_remaining` — on both success and failure paths. This is the durable record; nothing re-derives or estimates this number elsewhere.

## What Admin → Data Health actually shows today (confirmed real, not proposed)

`src/app/admin/data-health/page.tsx` already surfaces this — verified by reading the page, not assumed from the table's existence:

1. **A live "X requests left today" pill** next to the sync status header, sourced from the most recent `sync_runs` row with a non-null `provider_quota_remaining` (not necessarily the most recent run overall — a run that failed before any provider call leaves this column null, so the query specifically looks for the last row that *does* have a reading). Turns amber when remaining quota is ≤ 10.
2. **A "Quota used today" stat** in the four-stat summary strip: the highest quota reading seen today minus the lowest, both real `provider_quota_remaining` values — a real delta, not an estimate of request volume. (API-Football's quota counts down through the day and resets daily, so highest-seen-today is the best available proxy for "what today started with.")
3. **Per-run quota** on every row in the "Recent sync runs" list (`X quota left`), when that run recorded one.
4. **A quota-exhausted-specific message** ("Today's data is capped until tomorrow...") when a run's `error_message` indicates a 429, distinguished from a generic failure message.

Because `TheSportsDbProvider.getQuotaRemaining()` always returns `null`, a sync run made through TheSportsDB simply never contributes a `provider_quota_remaining` value — it's silently excluded from the "most recent reading" and "today's used" queries (both already filter `.not("provider_quota_remaining", "is", null)`), which is the correct, honest behavior: there is genuinely no quota number to show for that provider, so none is shown, rather than a fabricated one.

**No code changes were made to Data Health for this pass** — it already did this correctly before this pass started; this document exists so that fact is written down rather than re-discovered next time someone asks "does the admin see quota."

## The enforced budget (2026-08-19, migration 0091)

Everything above tracks what the provider *reports*. None of it bounded what KIVO *spends*, and that was the real gap:

- the quota floor only refuses once the provider's own remaining count is at or below 10, and that count is `null` until some request has recorded one — so on a fresh day, the exact window in which a once-a-minute worker is most likely to run away is the window in which the guard is asleep;
- `auto-sync.ts` bounded the *rate* (a 3-minute cooldown) and not the *total*, which permits up to 480 requests a day against a ~100/day tier.

`provider_request_spend` plus `consume_provider_requests()` is the bound. Three properties matter:

**Asking and spending are one statement.** A count-then-insert pair is not a budget: under READ COMMITTED two callers each take their own snapshot, both count under the limit, and both spend — and there is no row to lock, because what needs locking is an *absence* of rows. The consume takes a transaction-scoped advisory lock keyed on `(provider, bucket)`, exactly as migration 0066's `consume_rate_limit` does for the same reason. A refusal means the provider client is never constructed.

**The ceiling is the database's, not the caller's.** An earlier draft passed the limit as an argument, which is check-then-act one level up — a caller that supplies its own ceiling decides its own ceiling. `provider_request_limit(bucket)` holds the real numbers, and an unrecognised bucket returns 0, so a typo fails closed. The TypeScript constants in `request-budget.ts` are a display mirror; a drift between them can make a Data Health figure look wrong but can never let a request through that the database would have refused.

**Separate allowances, not one pool with a floor.** A reserve expressed as "stop when the shared pool gets low" fails the moment anything else spends unexpectedly.

| Bucket | Allowance per rolling 24h | Consumer |
|---|---|---|
| `live` | 55 | The once-a-minute worker |
| `auto` | 20 | On-demand page-view freshness |
| `daily` | 8 | The daily baseline (fixtures + a few tables) |
| — | ~17 unbudgeted | Admin "Sync now". No automated path can reach it |

### Why a rolling window rather than a calendar day

Because KIVO cannot establish when API-Football's daily counter resets. This build environment has no route to api-football.com, and the only quota signal the adapter reads is `x-ratelimit-requests-remaining`, which is a count and not a reset time.

A trailing-window cap of N implies at most N spends in **any** 24-hour interval — including whatever calendar day the provider actually uses — so it is conservative under every possible reset time. Assuming UTC midnight and being wrong in the generous direction would mean the budget silently did not exist for part of every day.

**This is the argument, and it is written here rather than only in the migration, because the obvious "simplification" is a per-day counter and the reason not to is not visible from the code.** A per-day counter is smaller and faster and wrong in a way nobody would notice until a matchday.

### What the admin sees, and what a fan sees

Admin → Data Health's "Live worker" panel shows spend per bucket over the trailing 24 hours, the provider's own last reported remaining count, the worker's last decision, and — in plain English — why it is idle. An unreadable ledger reports as **fully spent** rather than as empty, deliberately: "nothing has been spent" is the one wrong answer that would make somebody turn the flag on.

On `/live`, when the live allowance is exhausted the page says so rather than presenting a frozen number as live. See `LiveFreshnessNote`.

## What still doesn't exist

- No cross-provider or cross-day quota history chart — the ledger holds 7 days and the panel shows a rolling 24 hours, but nothing plots it over time.
- No alerting (email/push) on quota exhaustion — it's visible on Data Health and on `/live`, and only when somebody looks.
- **No verification against a live provider.** Every number above is arithmetic over a modelled payload. This sandbox cannot reach api-football.com, so the budget arithmetic, the pacing and the refusal behaviour are unit-tested and the *live* behaviour is not. Nobody has watched a real match refresh through this.
