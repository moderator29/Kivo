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

## What doesn't exist

- No cross-provider or cross-day quota history chart — only "today's used" and "most recent reading" are computed, both from `sync_runs` rows, not a dedicated quota-tracking table.
- No proactive quota-based throttling (e.g. refusing a sync when remaining quota drops below some threshold) — a 429 is handled gracefully after the fact (classified, surfaced, not retried), but nothing pre-emptively blocks a sync from being *attempted* when quota is low.
- No alerting (email/push) on quota exhaustion — it's visible on Data Health only, and only when an admin looks.
