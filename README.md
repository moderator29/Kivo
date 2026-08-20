# KIVO

Football's next-generation fan operating system — live football data, an AI Copilot grounded in real data, a native social layer, fantasy, and predictions, built as one product rather than bolted-together features.

See `BUILD_PLAN.md` for what is built, what is next and what is deliberately not being built; `KIVO_BUILD_ACKNOWLEDGEMENT.md` for the full product vision, `DECISIONS.md` for why the stack looks the way it does, and `RECOMMENDATIONS.md` for the current audit-based backlog (a from-scratch read of the whole codebase, not a running log — it supersedes an earlier competitive-research log that lived at this same path, preserved in git history at commit `e515a6d`).

## Stack

- **Framework**: Next.js (App Router, TypeScript, Tailwind v4)
- **Identity**: Supabase Auth — email + password, with an emailed six-digit code as a secondary sign-in and `/forgot-password` for recovery. No social provider. (Clerk was removed 2026-08-18; passwords added 2026-08-19 — both in `DECISIONS.md`)
- **Application data**: Supabase (Postgres, RLS keyed on `auth.uid()`) — one vendor issues the session JWT and verifies it, so there is no cross-vendor trust to configure
- **Football data**: provider-agnostic abstraction (`src/lib/football`), currently backed by API-Football's free tier, with a development-only mock adapter so UI work never has to spend API quota; sync is admin-triggered on demand, not continuously polled
- **AI**: Anthropic Claude, live and grounded in real KIVO data when `ANTHROPIC_API_KEY` is set (`/ai`, `src/app/api/ai/chat/route.ts`)

## Documentation

Top-level documents, each written from the code rather than from a plan:

| | |
|---|---|
| `BUILD_PLAN.md` | What is built, what is next, what is deliberately not being built |
| `ARCHITECTURE.md` | How the pieces fit together |
| `API.md` | Route handlers, Server Actions, database functions, provider calls |
| `SOCIAL.md` | Posts, Match Rooms, polls, blocks, trending, fan sentiment |
| `NOTIFICATIONS.md` | Every type and producer, quiet hours, priority, and the batching that does not exist |
| `SECURITY.md` | Auth, RLS, `SECURITY DEFINER` discipline, privacy, open items |
| `DEPLOYMENT.md` | Getting a commit to production, and what only the founder can do |
| `ENVIRONMENT.md` | Every variable KIVO reads and what it switches on |
| `DECISIONS.md` | The calls with real consequences, and why |
| `BUILD_STATUS.md` | Living per-feature state |
| `RECOMMENDATIONS.md` | The numbered backlog |
| `HANDOFF.md` | Entry point for whoever picks this up next |

Topic-level documents live in `docs/`.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the three Supabase values — see ENVIRONMENT.md
npm run dev
```

The app boots and is fully usable (auth, social, admin) with just the Supabase keys configured — there is no manual dashboard step to complete first. Football data, AI, and email are optional; everything degrades to an honest "Coming Soon" or mock state without them.

## Project structure

```
src/
  app/
    (app)/                — authenticated-shell product surfaces (guest-viewable, sign-up-gated actions)
      home/                  — personalized feed / dashboard
      social/                — posts, one-level comment threads, six reaction types, in-feed polls, reports
      matches/, matches/[id]/  — fixture list + Match Centre (lineups, stats, fan ratings) and its Room tab
        (fixture-scoped posts, live scores when synced)
      teams/, teams/[id]/, teams/compare/  — club pages: squad, head-to-head, discipline, goal timing, transfer ledger
      players/, players/[id]/, players/compare/  — player pages: stats, photos, transfer history
      leagues/, leagues/[id]/  — competitions + standings
      managers/, managers/[id]/, venues/, venues/[id]/  — manager and stadium pages, synced alongside teams/fixtures
      fantasy/, fantasy/browse/  — squad builder, private + public league create/join/discovery, leaderboard
      predictions/, predictions/mine/  — picks, scoring, leaderboard, personal history
      transfers/, live/, discover/, news/, rewards/, saved/  — supporting surfaces
      ai/                    — AI Copilot chat UI (streaming, persisted/resumable conversation history)
      notifications/         — full notifications inbox (bell lives in the shared shell)
      profile/, profile/following/, u/[username]/  — own profile + public profiles
      settings/              — account/notification preference settings
    admin/                 — /admin, RBAC-gated, separate shell from the public app
      ai/, audit/, football/, moderation/, support/, users/
    onboarding/            — post-signup handle/profile setup, outside the (app) shell
    sign-in/, sign-up/     — KIVO's own email one-time-code auth forms (Supabase Auth)
    about/, privacy/, terms/  — static marketing/legal pages
    api/
      ai/chat/               — AI Copilot chat endpoint (Anthropic), streamed as NDJSON
      health/                — uptime check endpoint
  components/
    layout/, ui/           — app shell, nav, top bar, shared primitives
    social/, matches/, football/, notifications/, onboarding/, settings/, profile/,
    predictions/, teams/, players/, leagues/, transfers/, discover/,
    home/, admin/, ai/, marketing/
      (fantasy's builder/leaderboard/onboarding components live alongside
      their route files in app/(app)/fantasy/ rather than in components/)
  lib/
    supabase/              — server + browser clients, generated DB types
    football/               — FootballDataProvider abstraction + adapters, sync pipeline, head-to-head/results helpers
    ai/                      — Anthropic client + grounding helpers
    og/                      — OpenGraph image generation helpers
    navigation.ts            — single source of truth for primary nav
    notification-registry.ts, notifications.ts, notification-preferences.ts
    fantasy.ts, fantasy-scoring.ts, predictions.ts, rewards.ts, rate-limit.ts, audit.ts
    profile.ts, admin.ts, auth.ts, auth-actions.ts, countries.ts, format.ts, reactions.ts, text.ts, utils.ts,
    recently-viewed.ts
  hooks/                   — shared client-side hooks (e.g. focus trap)
supabase/migrations/      — version-controlled SQL, applied via Supabase MCP (34 migrations, 42 tables)
design/                    — icon manifest + processed brand assets
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` (or `npx tsc --noEmit`) | Typecheck |
| `npm test` | Run unit tests (Vitest) |
| `npm run test:watch` | Run unit tests in watch mode |

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test, and build on every push and PR, in that order.

## Documentation index

`KIVO_BUILD_ACKNOWLEDGEMENT.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `ENVIRONMENT.md` · `RECOMMENDATIONS.md` · `ICON_MANIFEST.md`
