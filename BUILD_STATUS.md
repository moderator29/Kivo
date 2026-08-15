# KIVO Build Status

Honest, evidence-based assessment of what exists in the codebase today, checked against the real files rather than assumed from file presence. Written 2026-08-15 as the baseline for the full-integration build pass described in the founder's directive of the same date. Status legend:

- **COMPLETE** — real, working, verified against the actual code.
- **PARTIAL** — real functionality exists but doesn't cover the full scope described.
- **PLACEHOLDER** — a route/component exists but shows a "Coming soon" state or stub, honestly, not fabricated.
- **NOT IMPLEMENTED** — doesn't exist yet.
- **BROKEN** — exists but doesn't work correctly.

This file is a living document — update it as each engine/surface below actually changes, not just when someone claims it changed.

## Authentication & identity

| Area | Status | Notes |
|---|---|---|
| Clerk sign up / sign in / sign out | COMPLETE | `src/app/sign-in/`, `src/app/sign-up/`, Clerk-hosted flows, KIVO-themed via `src/lib/clerk-appearance.ts` |
| Email verification | COMPLETE | Handled entirely by Clerk itself, no KIVO code involved |
| Protected routes | COMPLETE | Resource-level `auth.protect()` per layout (`(app)/layout.tsx`, `admin/layout.tsx`, `onboarding/page.tsx`) — proxy/middleware intentionally does optimistic-only checks, real enforcement is at the resource |
| Clerk → Supabase sync (webhook) | COMPLETE | `src/app/api/webhooks/clerk/route.ts` — svix signature verification, `user.created`/`user.updated`/`user.deleted`, idempotent (duplicate-key on retry is a no-op) |
| OAuth/social sign-in | NOT IMPLEMENTED | Not configured in Clerk yet — this is a Clerk Dashboard config change, not a code change, when the founder wants it |

## Football data & provider abstraction

| Area | Status | Notes |
|---|---|---|
| `FootballDataProvider` interface | COMPLETE | `src/lib/football/types.ts` — real interface, `ApiFootballProvider` and dev-only `MockFootballProvider` both implement it |
| API-Football integration | PARTIAL | Fixtures, lineups, events, standings, squads, managers, transfers, H2H are synced. NOT available on the free tier (confirmed, not assumed): injuries, referees, per-match individual player stats, xG on most competitions |
| TheSportsDB integration | NOT IMPLEMENTED (as of this doc) — being built this pass | Founder added `THE_SPORTS_DB_API_KEY` |
| Normalized domain models | COMPLETE | `NormalizedFixture`, `NormalizedTeam`, `NormalizedStandingRow`, etc. in `types.ts` — frontend never sees provider-shaped data |
| Quota/rate-limit awareness | PARTIAL | `api-football-request.ts` already parses `x-ratelimit-requests-remaining`, does one jittered retry on 5xx only, never retries 4xx — real, working, but not yet surfaced richly in Admin |
| Caching by volatility tier | PARTIAL | `last-synced.ts` tracks freshness; explicit TTL-by-data-type policy is not formally documented or enforced yet |
| Live polling | CORRECTLY DISABLED | `FOOTBALL_LIVE_POLLING_ENABLED=false`, gates a manual admin "Refresh live scores" action, no automated poll/worker exists — per standing decision, stays this way until real infrastructure below is built |
| Supabase Realtime distribution | COMPLETE for what exists today | Migration `0038_realtime_fixture_distribution` publishes `fixtures`/`fixture_events`; `src/hooks/use-realtime-fixtures.ts` + `LiveFixtureList`/`MatchScoreDisplay` push live score/status updates to every viewer the instant any sync writes fresh data — no polling, no page refresh. See `docs/LIVE_DATA.md`. |
| Automated server-side live worker (cron) | NOT IMPLEMENTED | Deliberately — today's upstream trigger is still an admin clicking "Sync now", not a scheduler. Realtime distribution is proven and ready for a worker to plug into once quota/dedup/health-monitoring are also verified. Do not flip `FOOTBALL_LIVE_POLLING_ENABLED` until then. |
| Data freshness metadata (`fetched_at`/`expires_at`/`data_status`) | PARTIAL | `retrievedAt` exists on fixtures; not yet a uniform pattern across every normalized type |

## KIVO intelligence layer

| Area | Status | Notes |
|---|---|---|
| Rating Engine (`kivoRating` vs `providerRating`) | COMPLETE (engine + tests + docs), NOT wired to UI | `src/lib/football/rating-engine.ts` — position-aware (GK/DEF/MID/FWD via the shared `positionGroup()`), versioned (`RATING_MODEL_VERSION`), `providerRating` typed and always `null` (API-Football's free tier supplies none). Returns `null` per match when a player has no real evidence of involvement (no minutes column exists — see `docs/RATING_ENGINE.md`). 20 unit tests. Deliberately not shown on a real screen yet — uncalibrated against real synced matches; see doc for why. |
| Form Engine (player/team last-5/10/season) | COMPLETE, reusable service | `src/lib/football/form-engine.ts` — generalizes the ad hoc "last 5" logic that used to live only in `teams/[id]/page.tsx`. W/D/L sequence + goals scored/conceded/GD/points for last-5/last-10/season windows, honest `isSufficientSample` below `MIN_FORM_SAMPLE` (2) real finished matches. 11 unit tests. Wired into `players/[id]/page.tsx` ("Recent form" section) and `src/lib/ai/grounding.ts` (favourite team's real form, with an honest "too few matches" line when insufficient). |
| Match Intelligence / `MatchInsights` | NOT IMPLEMENTED as a shared service | H2H, form, goal-timing exist individually; not unified into one object the AI Copilot or match preview consumes |
| Heatmap engine | COMPLETE (engine + UI + tests + docs), zero live positional data source | `src/lib/football/heatmap-engine.ts`'s `HeatmapEngine` — pure density-grid builder on a canonical pitch coordinate system matching `PitchLines`'s viewBox, 8 unit tests, zero import from/reference to the removed Sportmonks-tied `premium-stats.ts`. Always receives an empty observation set in production today (no provider connected) — that's the correct, expected state, not a bug. |
| `PositionalDataProvider` interface | COMPLETE, pure seam | `src/lib/football/positional-types.ts` — no current `FootballDataProvider` implements it; not wired to anything live; provider-agnostic by design (no vendor name anywhere in the file). |
| `HeatmapView` UI component | COMPLETE, not yet wired into Match Centre | `src/components/matches/heatmap-view.tsx` — reuses `PitchLines`'s visual language (same as `LineupPitch`); renders a real density overlay when data exists, otherwise a deliberate, polished "Positional data unavailable for this match" empty state. See `docs/HEATMAP_ENGINE.md` for why it isn't on a live tab yet. |
| Fantasy scoring | COMPLETE, documented as "FantasyScoringEngine" | `src/lib/fantasy-scoring.ts` is real and covers goals/assists/cards/clean sheets/captaincy — not rebuilt or renamed this pass (see `docs/FANTASY.md` for why the file path stayed the same); methodology now formally documented. |
| Transfer engine (confirmed vs. rumour) | COMPLETE | Confirmed-only by design — API-Football's free tier has no rumour tier, and `RECOMMENDATIONS.md` item 178 formally retired the idea of inventing a confidence-tier taxonomy. Never regressed. |

## Product surfaces (high level — see RECOMMENDATIONS.md for line-item detail)

| Area | Status |
|---|---|
| Match Centre (tabs, lineups, standings, H2H, fan verdict) | PARTIAL — real, substantial, missing per-player match stats and a formation pitch view landed this session; heatmap still unavailable (honest empty state, not faked) |
| Fantasy (squad builder, gameweeks, leaderboards) | COMPLETE for MVP scope |
| Social (feed, posts, polls, follows, match room) | COMPLETE for MVP scope |
| AI Copilot | COMPLETE, grounded in real synced data via `buildGroundingContext` |
| Notifications | PARTIAL — in-app notifications exist for a subset of event types; no push-ready architecture yet |
| Search | PARTIAL — command palette covers players/teams/matches; no "recent/trending searches" yet |
| Admin (users, moderation, data health) | PARTIAL — real, but data-quality tooling (duplicate detection, missing-logo detection) doesn't exist yet |

## Sportmonks

REMOVED this pass, per explicit founder directive. Was never a live integration (no HTTP calls existed) — was schema + a gated stub for a vendor that's no longer in scope. See `DECISIONS.md` for the removal record.
