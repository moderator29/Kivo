# KIVO

Football's next-generation fan operating system — live football data, an AI Copilot grounded in real data, a native social layer, fantasy, and predictions, built as one product rather than bolted-together features.

See `KIVO_BUILD_ACKNOWLEDGEMENT.md` for the full product vision, `DECISIONS.md` for why the stack looks the way it does, and `RECOMMENDATIONS.md` for the current audit-based backlog (a from-scratch read of the whole codebase, not a running log — it supersedes an earlier competitive-research log that lived at this same path, preserved in git history at commit `e515a6d`).

## Stack

- **Framework**: Next.js (App Router, TypeScript, Tailwind v4)
- **Identity**: Clerk (email + X for MVP)
- **Application data**: Supabase (Postgres, RLS, authorized via Clerk's native third-party JWT integration — no shared-secret JWT template)
- **Football data**: provider-agnostic abstraction (`src/lib/football`), currently backed by API-Football's free tier, with a development-only mock adapter so UI work never has to spend API quota; sync is admin-triggered on demand, not continuously polled
- **AI**: Anthropic Claude, live and grounded in real KIVO data when `ANTHROPIC_API_KEY` is set (`/ai`, `src/app/api/ai/chat/route.ts`)

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in Clerk + Supabase values — see ENVIRONMENT.md
npm run dev
```

The app boots and is fully usable (auth, social, admin) with just Clerk + Supabase configured. Football data, AI, and email are optional — everything degrades to an honest "Coming Soon" or mock state without them. See `ENVIRONMENT.md` for the one manual Supabase↔Clerk dashboard step required before RLS-gated queries will work.

## Project structure

```
src/
  app/
    (app)/                — authenticated product surfaces, shared shell/nav
      home/                 — personalized feed / dashboard
      social/               — posts, comments, reactions, reports
      matches/[id]/         — Match Centre (score, lineups, stats) + Match Room (fixture-scoped posts)
      teams/[id]/, teams/compare/, players/[id]/, leagues/[id]/  — football entity pages
      fantasy/              — league create/join, squad builder, leaderboard
      predictions/          — picks + leaderboard
      transfers/, live/, discover/, news/, rewards/  — supporting surfaces
      ai/                   — AI Copilot chat UI
      notifications/        — notifications inbox
      profile/, profile/following/, u/[username]/  — own profile + public profiles
      settings/             — account/notification preference settings
    admin/                 — /admin, RBAC-gated, separate shell from the public app
      data-health/, moderation/, users/
    onboarding/            — post-signup handle/profile setup, outside the (app) shell
    sign-in/, sign-up/     — Clerk-hosted auth flows
    api/
      ai/chat/               — AI Copilot chat endpoint (Anthropic)
      webhooks/clerk/        — Clerk → Supabase profile sync
  components/
    layout/, ui/           — app shell, nav, top bar, shared primitives
    social/, matches/, notifications/, onboarding/, settings/, profile/,
    predictions/, teams/, players/, leagues/, transfers/, discover/,
    home/, admin/, ai/, marketing/
      (fantasy's builder/leaderboard/onboarding components live alongside
      their route files in app/(app)/fantasy/ rather than in components/)
  lib/
    supabase/              — server + browser clients, generated DB types
    football/               — FootballDataProvider abstraction + adapters
    ai/                      — Anthropic client + grounding helpers
    og/                      — OpenGraph image generation helpers
    navigation.ts            — single source of truth for primary nav
    notification-registry.ts, notifications.ts, notification-preferences.ts
    fantasy.ts, predictions.ts, rewards.ts, rate-limit.ts, audit.ts
    profile.ts, admin.ts, clerk.ts, countries.ts, format.ts, utils.ts,
    recently-viewed.ts
supabase/migrations/      — version-controlled SQL, applied via Supabase MCP (15 migrations)
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
