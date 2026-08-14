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

Nothing in routes, components, or the database imports a concrete provider — everything goes through `getFootballDataProvider()` in `src/lib/football/index.ts`. Swapping in Sportmonks later, or adding a second provider for fallback, touches one file. Live polling is feature-flagged off (`FOOTBALL_LIVE_POLLING_ENABLED`) until real API quota exists — see `DECISIONS.md`.

## Database

34 tables across identity, football entities (schema-ready, lean until a provider is live), provider infrastructure, social, predictions/rewards, fantasy, notifications, AI, and admin/audit — see `supabase/migrations/0001_kivo_core_schema.sql` for the full DDL and the reasoning behind each RLS policy (recorded as inline SQL comments, not just here). Regenerate `src/lib/supabase/types.ts` after every migration.

## Admin

`/admin` is a separate route tree with its own layout, gated server-side by `hasAdminAccess(profile.role)` (never a client-only check) — RLS on every admin-touched table backs this up independently, so a bypassed UI guard still can't read/write data the role doesn't own.

## What's real vs. architected-but-not-live

**Live now**: auth (Clerk + Supabase), profiles, Social (posts/comments schema, posts + reactions UI), admin (RBAC, overview, moderation queue, user list — all reading real data).

**Architected, not yet connected**: football data (provider abstraction built, no API key set by default), AI Copilot (grounding architecture designed, no model wired), fantasy/predictions (full schema live, no UI yet), notifications (schema live, no delivery pipeline).

Every "architected, not yet connected" surface shows an honest Coming Soon state in the product — never a fabricated one.
