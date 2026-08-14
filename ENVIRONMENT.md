# KIVO — Environment Variables

Every variable KIVO reads, why it exists, and where to get it. Never commit real values — `.env.local` is gitignored; `.env.example` holds names only.

## ⚠️ One manual step only the founder can complete

Supabase's native third-party auth integration (Clerk JWTs authorizing Postgres/RLS) is configured **in the Supabase dashboard**, not through code or migrations — no API exposes this step. Before Clerk-authenticated requests can read/write Supabase data:

1. Supabase Dashboard → **Authentication → Sign In / Providers → Third Party Auth** → Add provider → **Clerk**.
2. Enter your Clerk instance's domain (find it in Clerk Dashboard → **Configure → Domains** — looks like `your-app.clerk.accounts.dev` in development, or your custom domain in production).
3. Save. No JWT template, no shared secret — Supabase verifies Clerk's tokens directly against Clerk's public JWKS.

Until this is done, every RLS-gated query will be rejected (the JWT won't be trusted), even with all the env vars below set correctly.

---

## App

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Canonical app URL, used for OG metadata / absolute links. Read in `src/app/layout.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts` | Optional | Defaults to `http://localhost:3000` in dev |

`NEXT_PUBLIC_APP_NAME` also appears in `.env.example` but is not read anywhere in `src/` today — see "Reserved / not currently read by the app" below.

## Clerk — identity & authentication (primary auth provider)

| Variable | Purpose | Required | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Client-side Clerk key | **Required** | Clerk Dashboard → API Keys |
| `CLERK_SECRET_KEY` | Server-side Clerk key | **Required**, server-only | Clerk Dashboard → API Keys |
| `CLERK_WEBHOOK_SECRET` | Verifies `/api/webhooks/clerk` signatures (svix) | **Required** for profile sync | Clerk Dashboard → Webhooks → your endpoint → Signing Secret |

MVP sign-in methods: **Email + X only** (see `DECISIONS.md`). Enable "Sign in with X" in Clerk Dashboard → User & Authentication → Social Connections. Google/Apple are architected for but not enabled yet.

Webhook endpoint to register in Clerk: `${NEXT_PUBLIC_APP_URL}/api/webhooks/clerk`, subscribed to `user.created`, `user.updated`, `user.deleted`.

## Supabase — application data & backend (not used for auth)

| Variable | Purpose | Required | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | **Required** | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key — RLS-gated, safe client-side | **Required** | Supabase Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS — server-only, trusted contexts only (webhooks, admin mutations) | **Required**, server-only | Supabase Dashboard → Project Settings → API |

Current project: `gkyjfihxxdynfwqhhpyn` (already connected — do not create a second project).

## Football data — provider abstraction (see `DECISIONS.md`)

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `API_FOOTBALL_KEY` | API-Football key (free tier for MVP — $0 budget, see DECISIONS.md). Read in `src/lib/football/index.ts` and `src/app/admin/data-health/*` | Optional | [dashboard.api-football.com](https://dashboard.api-football.com) — without this, a development-only mock provider is used automatically (never in production) |
| `FOOTBALL_LIVE_POLLING_ENABLED` | Feature flag, read in `src/lib/football/index.ts` — must stay `false`/unset until real API quota exists | Optional, default off | Never flip to `true` on the free tier |

## AI Copilot

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Powers the AI Copilot's grounded responses. Read in `src/lib/ai/client.ts` | Optional | Without it, `/ai` stays in its Coming Soon state — nothing breaks. When set, `/ai` and `src/app/api/ai/chat/route.ts` are fully live |
| `AI_MODEL` | Overrides the Claude model id used for Copilot responses. Read in `src/lib/ai/client.ts` | Optional | Defaults to `claude-sonnet-4-5` if unset |

---

## Reserved / not currently read by the app

These are declared in `.env.example` for a feature that's designed but not built yet. Nothing in `src/` calls `process.env` for any of them today — setting them has no effect. Confirmed by grepping every `process.env.` reference in `src/`.

| Variable | Purpose once built | Status |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | Would override the "KIVO" display name in metadata/UI | Not implemented — "KIVO" is hardcoded instead; setting this has no effect |
| `SPORTMONKS_API_TOKEN` | Reserved for a future second/primary football provider once budget allows | Not implemented — the `FootballDataProvider` interface is ready for this adapter, but nothing reads this variable yet |
| `RESEND_API_KEY` | Transactional email (not auth — Clerk handles verification/reset emails itself) | Not wired — [resend.com](https://resend.com) |
| `RESEND_FROM_EMAIL` | Sending address for transactional email | Not wired — requires a verified sending domain before production |
| `CRON_SECRET` | Would authorize scheduled job endpoints if/when background sync jobs exist | Not used — all football syncs today are admin-triggered on demand, not cron |
| `WEBHOOK_SECRET` | Reserved for future non-Clerk webhook consumers | Not used — `CLERK_WEBHOOK_SECRET` is the only webhook secret actually read |

---

## Local setup

1. `cp .env.example .env.local`
2. Fill in Clerk + Supabase values (both required to run the app at all).
3. Complete the manual Supabase↔Clerk dashboard step above.
4. `npm run dev`

Everything else (football provider, AI, email) is optional — the app degrades gracefully (Coming Soon states, mock data in dev) without them, by design.
