# KIVO — Environment Variables

Every variable KIVO reads, why it exists, and where to get it. Never commit real values — `.env.local` is gitignored; `.env.example` holds names only.

## Bringing real data online — what each key actually does the moment it's added

This is the plain-language version, audited 2026-08-15 by tracing every code path each variable gates end to end (see `src/lib/football/index.ts`, `src/lib/football/sync*.ts`, `src/app/admin/data-health/actions.ts`, `src/lib/ai/client.ts`, `src/app/api/ai/chat/route.ts`). No further code changes are needed for the first two — they're genuinely plug-and-play.

| Variable | The moment you paste it into Vercel and redeploy |
|---|---|
| `API_FOOTBALL_KEY` | **Instantly works.** `getFootballDataProvider()` switches from the dev-only mock straight to the real API-Football adapter — no other flag or step needed. Every sync path (today's fixtures, a team's squad, a fixture's lineups/events/stats, a season's standings, a player's transfer history) already calls the provider through that same one entry point, so all of them start hitting the real API immediately. On Admin → Data Health, the "Sync now" button and every per-item sync action already refuse to run without this key set (so nothing can silently "succeed" against mock data in production) — once it's set, those buttons trigger real syncs right away. Nothing hardcodes mock-only behavior anywhere in the sync layer. |
| `ANTHROPIC_API_KEY` | **Instantly works.** `isAiConfigured()` is the single gate checked by the `/ai` page (swaps from its Coming Soon state to the real chat UI) and by `/api/ai/chat` (returns a real streamed, grounded Claude response instead of a 503). There is no leftover stale/mock AI response anywhere — every code path that talks to Anthropic goes through `getAnthropicClient()`, which itself refuses to run without the key. |
| `SPORTMONKS_API_TOKEN` | **Needs one more short build pass first — this is NOT plug-and-play yet.** `isPremiumStatsConfigured()` will correctly flip to "true," but nothing actually calls Sportmonks: `getPremiumStatsProvider()` deliberately throws "configured but not implemented yet," because no HTTP client for Sportmonks has been written — there was never a vendor account to build one against. This is intentional, not a bug: rather than fabricate fake market-value/contract/heatmap numbers, the interface, database columns, and a scoped implementation plan (candidate real Sportmonks v3 endpoints to call) are ready and waiting in `src/lib/football/premium-stats.ts` and `DECISIONS.md`, so wiring it up once the founder has a confirmed Sportmonks account is a short, scoped follow-up rather than a fresh investigation — not something that happens automatically by adding the key. |

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

These are declared in `.env.example` for a feature that's designed but not built yet. Setting them has no functional effect today (`SPORTMONKS_API_TOKEN` is the one exception — see below). Confirmed by grepping every `process.env.` reference in `src/`.

| Variable | Purpose once built | Status |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | Would override the "KIVO" display name in metadata/UI | Not implemented — "KIVO" is hardcoded instead; setting this has no effect |
| `SPORTMONKS_API_TOKEN` | Reserved for a future premium provider covering player market value, contract expiry, and per-player match heat maps — the three fields API-Football's free tier doesn't report | Partially read but NOT functional: `src/lib/football/premium-stats.ts`'s `isPremiumStatsConfigured()` does read this and will correctly report `true` once it's set, but `getPremiumStatsProvider()` still unconditionally throws — no HTTP client calling Sportmonks exists yet. See that file's scoped implementation plan (candidate real v3 endpoints, not yet verified against a live account) and `DECISIONS.md`'s 2026-08-15 audit update. Setting this key alone does not bring any premium stats online. |
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
