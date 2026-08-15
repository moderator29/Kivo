# KIVO — Architecture

## Identity & data separation

```
KIVO USER
    │
    ▼
┌─────────┐   Clerk session token (JWT)   ┌─────────────┐
│  CLERK  │ ─────────────────────────────▶│  KIVO APP   │
│         │                                │ (Next.js)   │
│ Identity│                                └──────┬──────┘
│ Sessions│                                       │ same JWT, passed as
│ Email/X │                                       │ accessToken — no template,
└─────────┘                                       │ no shared secret
                                                   ▼
                                          ┌──────────────────┐
                                          │     SUPABASE      │
                                          │  Postgres + RLS    │
                                          │  authorized via     │
                                          │  Clerk JWKS (native  │
                                          │  third-party auth)   │
                                          └─────────┬────────────┘
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                              Football APIs   AI (Anthropic)     Resend
                            (provider-agnostic)  (grounded)   (transactional, TBD)
```

Clerk answers "who are you." Supabase answers "what does KIVO know about you and what can you do." RLS policies key off `auth.jwt() ->> 'sub'` (the Clerk user id) — never Supabase Auth, which is not used anywhere in this codebase. Every user-owned table traces back to `profiles.clerk_user_id`, and Clerk's own identity fields (email, name) are deliberately not duplicated into Supabase — see `DECISIONS.md`.

## Request-time profile guarantee

A Clerk webhook (`/api/webhooks/clerk`) creates/updates/deletes the matching `profiles` row on `user.created` / `user.updated` / `user.deleted`, idempotently (duplicate-key on retry is treated as success, not an error). As a resilience fallback — in case the webhook isn't configured yet in a given environment — `(app)/layout.tsx` and `admin/layout.tsx` call `getOrCreateProfile()` on every authenticated request, which creates a profile row on the spot if one is somehow missing. The app never depends on the webhook alone to function.

## Football data: provider abstraction

```
FootballDataProvider (interface)
         │
    ┌────┴─────┐
    ▼          ▼
ApiFootballProvider   MockFootballProvider (dev-only, throws in production)
```

Nothing in routes, components, or the database imports a concrete provider — everything goes through `getFootballDataProvider()` in `src/lib/football/index.ts`. A second provider, TheSportsDB, now exists alongside API-Football (`FOOTBALL_DATA_PROVIDER` env var selects it) — see `docs/PROVIDER_ABSTRACTION.md`. Live polling is feature-flagged off (`FOOTBALL_LIVE_POLLING_ENABLED`) until real API quota exists — see `DECISIONS.md`.

## Database

42 tables across identity, football entities, provider infrastructure, social, predictions/rewards, fantasy, notifications, AI, rate limiting, and admin/audit — confirmed against the live project (`gkyjfihxxdynfwqhhpyn`) via the Supabase MCP `list_tables` call, not just counted from migration files. See `supabase/migrations/0001_kivo_core_schema.sql` for the original 34-table DDL and the reasoning behind each RLS policy (recorded as inline SQL comments, not just here). Five later migrations added eight more tables on top of that baseline:

- `fixture_statistics` (0005) — real per-team match stats from API-Football's `/fixtures/statistics` endpoint (no fabricated/Sofascore-only metrics).
- `transfers` (0006) — real recorded transfer history from API-Football's `/transfers` endpoint.
- `fantasy_player_prices` (0007) — KIVO's own internal fantasy-game pricing currency (not a real market value).
- `rate_limit_events` (0013) — sliding-window event log backing `checkRateLimit()` in `src/lib/rate-limit.ts`.
- `fan_ratings`, `poll_options`, `poll_votes`, `saves` (0032) — real per-user match ratings, in-feed poll options/votes, and the saved-post/team/player/competition watchlist.

Every other migration (0002–0004, 0008–0031 except 0032, 0033–0034) adds `SECURITY DEFINER` RPCs, seed data, or RLS/grant/index hardening on top of the existing schema rather than a new table — see "Cross-user reads" below for the RPCs. Regenerate `src/lib/supabase/types.ts` after every migration.

## Cross-user reads: SECURITY DEFINER RPCs

Every user-owned table (`profiles`, `fantasy_teams`, `predictions`, ...) is RLS-locked to `own row or admin` by design — correct for privacy, but it means leaderboards, shared-league views, and public profiles can never be built from a plain client-side `select`. Each of these surfaces is instead backed by a narrow `SECURITY DEFINER` Postgres function that returns only the specific aggregate or public-safe columns needed, never a raw table passthrough:

- `get_fantasy_team_league(p_team_id)` (0009) — lets a league *member* (not just its creator) read the league row their own team belongs to.
- `get_fantasy_league_leaderboard(p_team_id)` (0010) — cross-member fantasy league standings.
- `get_public_profiles(p_ids uuid[])` (0011) — public-safe profile fields (username, avatar, etc.) for post/comment authors and leaderboard rows, for guests and other users alike.
- `get_predictions_leaderboard(p_limit)` (0012) — cross-user predictions standings.
- `get_public_profile_by_username(p_username)` / `get_public_profile_stats(p_profile_id)` (0014) — backs `/u/[username]` public profile pages.
- `is_username_available(p_username, p_exclude_profile_id)` (0015) — live-as-you-type username collision check for onboarding and Settings, without a 34-column profile leak.
- `list_public_fantasy_leagues(p_search_pattern, p_limit, p_offset)` / `join_public_fantasy_league(p_league_id)` (0027) — backs `/fantasy/browse`: lists other users' public leagues with real team counts and lets a user join one, without ever exposing a private league's row.
- `get_prediction_consensus(p_fixture_ids uuid[])` (0032) — cross-user pick-split percentages on `PredictionCard`, rendered only above a real minimum sample size.
- `get_fan_rating_summary(p_fixture_id)` (0032) — cross-user fan rating average on `FanRatingCard`, same real-sample floor.
- `get_poll_results(p_post_id)` (0032) — cross-user poll vote counts for in-feed polls.

## Admin

`/admin` is a separate route tree with its own layout, gated server-side by `hasAdminAccess(profile.role)` (never a client-only check) — RLS on every admin-touched table backs this up independently, so a bypassed UI guard still can't read/write data the role doesn't own.

## Preview mode (admin-only sample data, never shown to real users)

General-purpose infrastructure for any not-yet-synced field that should render nothing (not a fake number) for real visitors until real data exists, while still letting an **admin** preview what the UI will look like once it does. Its original consumer — a player-profile "Market" section (market value, contract expiry) gated on a Sportmonks-shaped schema — was removed on 2026-08-15 when Sportmonks was dropped from the project entirely (see `DECISIONS.md`); the mechanism has no active consumer today but stays in place for the next real not-yet-synced field that needs it.

**How it works** (`src/lib/preview-mode.ts`):
- An admin turns it on via the "Preview" toggle in the app top bar (only rendered for `hasAdminAccess(profile.role)`), or directly at `GET /admin/preview-mode?on=1`. That route re-checks admin access itself server-side before doing anything — the toggle button carries no authority of its own.
- On success it sets a short-lived (4h), `httpOnly`, `sameSite=lax` cookie (`kivo_preview_mode`). Nothing else in the app ever writes this cookie.
- `isPreviewModeActive(profile)` is the only read path: it returns `true` **only if both** `hasAdminAccess(profile.role)` is true **and** the cookie is present — checked fresh, server-side, on every request. A guest, a non-admin, or an environment variable can never turn this on; there is no default-on path.
- When active, gated sections fill a still-null field with a hardcoded sample value instead of rendering nothing, alongside the real branch (a non-null field always renders its real value, untouched, un-marked).

**Safety guarantees a screenshot or a non-admin session can rely on:**
1. A fixed, page-wide amber banner ("Preview mode — sample data, not real. Visible to admins only.") renders on every `(app)` page for as long as the cookie + admin conditions hold (`src/components/layout/preview-mode-banner.tsx`, wired in `src/components/layout/app-shell.tsx`).
2. Every individual faked field additionally gets its own marker — a dashed amber border plus an asterisk with a tooltip (`src/components/ui/preview-marker.tsx`) — so a cropped screenshot of just that field, without the banner in frame, still can't be mistaken for real data.
3. Preview mode is opt-in per admin session (cookie), not a build/env flag — it can't silently affect any other visitor, in any environment, ever.

Applying the same pattern elsewhere: check `hasAdminAccess` + `isPreviewModeActive(profile)`, only substitute a sample value for a field that is genuinely null, and always pair it with `PREVIEW_FIELD_CLASSNAME`/`PreviewAsterisk` — never substitute over a real value.

## What's real vs. architected-but-not-live

**Live now**: auth (Clerk + Supabase), profiles, Social (posts, one-level comment threads, all six reaction types, in-feed polls, reports feeding the moderation queue), Match Rooms (fixture-scoped posts inside Match Centre's Room tab), fan match ratings and the shareable Match Verdict summary, saved posts/teams/players/competitions (watchlist) and follows, Fantasy (public + private league creation, public league discovery/browse, squad builder, admin-triggered gameweek scoring, roster carry-forward between gameweeks, leaderboard), Predictions (picks, admin-triggered scoring, leaderboard, cross-user consensus), AI Copilot (Anthropic Claude, streaming responses, grounded chat, persisted and resumable conversation history — live when `ANTHROPIC_API_KEY` is set), Notifications (in-app bell + full notifications page, typed notification registry), onboarding, Settings, public profiles (`/u/[username]`), team and player detail pages (head-to-head record, discipline table, goal-timing distribution, real transfer history, player photos), team/player comparison, manager pages, venue pages, admin (RBAC, overview, moderation queue, user list, data-health sync triggers with a quota/trend summary strip — all reading/writing real data).

**Architected, not yet connected**: live football data at scale (provider abstraction built and API-Football-backed, a second TheSportsDB provider now also implemented, but sync is admin-triggered on demand rather than continuously polled — `FOOTBALL_LIVE_POLLING_ENABLED` stays off until real API quota exists, and no live worker/Realtime distribution has been built — see `docs/DATA_ARCHITECTURE.md`), transactional email (Resend vars reserved, nothing sends yet), `notification_deliveries` (table and RLS exist, but no delivery pipeline writes to it — the in-app bell/page read `notifications` directly).

Every "architected, not yet connected" surface shows an honest Coming Soon state in the product — never a fabricated one.
