# KIVO

Football's next-generation fan operating system — live football data, an AI Copilot grounded in real data, a native social layer, fantasy, and predictions, built as one product rather than bolted-together features.

See `KIVO_BUILD_ACKNOWLEDGEMENT.md` for the full product vision, `DECISIONS.md` for why the stack looks the way it does, and `RECOMMENDATIONS.md` for the continuously-updated product/UX backlog.

## Stack

- **Framework**: Next.js (App Router, TypeScript, Tailwind v4)
- **Identity**: Clerk (email + X for MVP)
- **Application data**: Supabase (Postgres, RLS, authorized via Clerk's native third-party JWT integration — no shared-secret JWT template)
- **Football data**: provider-agnostic abstraction (`src/lib/football`), currently backed by API-Football's free tier, with a development-only mock adapter so UI work never has to spend API quota
- **AI**: Anthropic Claude (grounding architecture in place; not yet wired to a live key)

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
    (app)/          — authenticated product surfaces (Home, Social, Coming Soon pages, ...)
    admin/           — /admin, RBAC-gated, separate shell from the public app
    sign-in/, sign-up/
    api/webhooks/clerk/  — Clerk → Supabase profile sync
  components/
    layout/          — app shell, nav, top bar
    social/          — post composer/card
    ui/               — shared primitives (Coming Soon, etc.)
  lib/
    supabase/        — server + browser clients, generated DB types
    football/        — FootballDataProvider abstraction + adapters
    navigation.ts     — single source of truth for primary nav
    profile.ts, admin.ts
supabase/migrations/  — version-controlled SQL, applied via Supabase MCP
design/                — icon manifest + processed brand assets
```

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Typecheck |

## Documentation index

`KIVO_BUILD_ACKNOWLEDGEMENT.md` · `ARCHITECTURE.md` · `DECISIONS.md` · `ENVIRONMENT.md` · `RECOMMENDATIONS.md` · `ICON_MANIFEST.md`
