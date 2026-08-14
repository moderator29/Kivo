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
| `NEXT_PUBLIC_APP_URL` | Canonical app URL, used for OG metadata / absolute links | Optional | Defaults to `http://localhost:3000` in dev |
| `NEXT_PUBLIC_APP_NAME` | Display name | Optional | Defaults to `KIVO` |

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
| `API_FOOTBALL_KEY` | API-Football key (free tier for MVP — $0 budget, see DECISIONS.md) | Optional | [dashboard.api-football.com](https://dashboard.api-football.com) — without this, a development-only mock provider is used automatically (never in production) |
| `SPORTMONKS_API_TOKEN` | Reserved for the future primary provider once budget allows | Optional, not yet implemented | Not required — the `FootballDataProvider` interface is ready for this adapter |
| `FOOTBALL_LIVE_POLLING_ENABLED` | Feature flag — must stay `false`/unset until real API quota exists | Optional, default off | Never flip to `true` on the free tier |

## AI Copilot

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Powers the AI Copilot's grounded responses | Optional | Without it, `/ai` stays in its Coming Soon state — nothing breaks |

## Email

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `RESEND_API_KEY` | Transactional email (not auth — Clerk handles verification/reset emails itself) | Optional, not yet wired | [resend.com](https://resend.com) |
| `RESEND_FROM_EMAIL` | Sending address | Optional, not yet wired | Requires a verified sending domain before production |

## Jobs / webhooks

| Variable | Purpose | Required |
|---|---|---|
| `CRON_SECRET` | Authorizes scheduled job endpoints once background sync jobs exist | Not yet used |
| `WEBHOOK_SECRET` | Reserved for future non-Clerk webhook consumers | Not yet used |

---

## Local setup

1. `cp .env.example .env.local`
2. Fill in Clerk + Supabase values (both required to run the app at all).
3. Complete the manual Supabase↔Clerk dashboard step above.
4. `npm run dev`

Everything else (football provider, AI, email) is optional — the app degrades gracefully (Coming Soon states, mock data in dev) without them, by design.
