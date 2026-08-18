# KIVO — Environment Variables

Every variable KIVO reads, why it exists, and where to get it. Never commit real values — `.env.local` is gitignored; `.env.example` holds names only.

## Bringing real data online — what each key actually does the moment it's added

This is the plain-language version, audited 2026-08-15 by tracing every code path each variable gates end to end (see `src/lib/football/index.ts`, `src/lib/football/sync*.ts`, `src/app/admin/data-health/actions.ts`, `src/lib/ai/client.ts`, `src/app/api/ai/chat/route.ts`). No further code changes are needed for the first two — they're genuinely plug-and-play.

| Variable | The moment you paste it into Vercel and redeploy |
|---|---|
| `API_FOOTBALL_KEY` | **Instantly works.** `getFootballDataProvider()` switches from the dev-only mock straight to the real API-Football adapter — no other flag or step needed. Every sync path (today's fixtures, a team's squad, a fixture's lineups/events/stats, a season's standings, a player's transfer history) already calls the provider through that same one entry point, so all of them start hitting the real API immediately. On Admin → Data Health, the "Sync now" button and every per-item sync action already refuse to run without this key set (so nothing can silently "succeed" against mock data in production) — once it's set, those buttons trigger real syncs right away. Nothing hardcodes mock-only behavior anywhere in the sync layer. |
| `ANTHROPIC_API_KEY` | **Instantly works.** `isAiConfigured()` is the single gate checked by the `/ai` page (swaps from its Coming Soon state to the real chat UI) and by `/api/ai/chat` (returns a real streamed, grounded Claude response instead of a 503). There is no leftover stale/mock AI response anywhere — every code path that talks to Anthropic goes through `getAnthropicClient()`, which itself refuses to run without the key. |
| `THE_SPORTS_DB_API_KEY` | **Instantly works, but only if `FOOTBALL_DATA_PROVIDER=thesportsdb` is also set.** `getFootballDataProvider()` defaults to API-Football; TheSportsDB is a config-selectable alternative provider (`src/lib/football/providers/thesportsdb.ts`), not a fallback that activates automatically. See `docs/PROVIDER_ABSTRACTION.md` for what it does and doesn't support on the free tier. |

## ⚠️ One manual step only the founder can complete

Supabase's native third-party auth integration (Clerk JWTs authorizing Postgres/RLS) is configured **in the Supabase dashboard**, not through code or migrations — no API exposes this step. Before Clerk-authenticated requests can read/write Supabase data:

1. Supabase Dashboard → **Authentication → Sign In / Providers → Third Party Auth** → Add provider → **Clerk**.
2. Enter your Clerk instance's domain (find it in Clerk Dashboard → **Configure → Domains** — looks like `your-app.clerk.accounts.dev` in development, or your custom domain in production).
3. Save. No JWT template, no shared secret — Supabase verifies Clerk's tokens directly against Clerk's public JWKS.

Until this is done, every RLS-gated query will be rejected (the JWT won't be trusted), even with all the env vars below set correctly.

## ⚠️ Changing a Clerk key? You must trigger a brand-new Vercel deployment, not just save the env var

This is a real, concrete failure mode, not a theoretical one — if sign-up/sign-in silently breaks (a verification code arrives, but submitting it bounces back to the sign-in/sign-up form instead of completing) right after adding or changing a Clerk key, **this is almost certainly why**.

`next.config.ts` computes the Content-Security-Policy's Clerk allowlist (`connect-src`/`script-src`/`frame-src`) by decoding `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` **at build time** (`resolveClerkFrontendApiHost()`) — this is a hard Next.js constraint: `NEXT_PUBLIC_*` variables are baked into the build output, not read fresh at runtime. Saving a new value for this variable in the Vercel dashboard does **not** retroactively change an already-built deployment's CSP header. If the key changes (a different Clerk instance, dev → production keys, a typo fixed) but the site is still serving an old build, the CSP will allow the *previous* Clerk frontend API host — meaning the *new* key's actual verification/session network calls get silently blocked by the browser's CSP, while the sign-up form itself still renders fine (that part just needs the key to be present in the client bundle, not for the CSP to match it). The user sees: code arrives by email, but submitting it does nothing/bounces back — exactly the CSP blocking the network call, with no visible error unless you open the browser's DevTools console (a CSP violation there confirms this diagnosis immediately).

**The fix**: after changing any Clerk (or Supabase) env var in Vercel, trigger an actual new deployment — the dashboard's "Redeploy" action on the latest deployment works, or push a new commit. Simply saving the env var is not enough.

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
| `THE_SPORTS_DB_API_KEY` | TheSportsDB v1 API key, embedded in the request path (not a header) by `src/lib/football/providers/thesportsdb.ts`. Read only when `FOOTBALL_DATA_PROVIDER=thesportsdb` | Optional | [thesportsdb.com/free_sports_api](https://www.thesportsdb.com/free_sports_api) (Patreon key at [patreon.com/thesportsdb](https://www.patreon.com/thesportsdb) for the v2/premium tier — not used here) — see `docs/API_FOOTBALL.md` and `docs/PROVIDER_ABSTRACTION.md` for real free-tier coverage/limits |
| `FOOTBALL_DATA_PROVIDER` | Selects which provider `getFootballDataProvider()` returns: `api-football` (default) or `thesportsdb`. Read in `src/lib/football/index.ts` | Optional, default `api-football` | Any other/unrecognized value falls back to `api-football` rather than failing the build |
| `FOOTBALL_LIVE_POLLING_ENABLED` | Feature flag, read in `src/lib/football/index.ts` — must stay `false`/unset until real API quota exists | Optional, default off | Never flip to `true` on the free tier |
| `FOOTBALL_SYNC_COMPETITION_IDS` | RECOMMENDATIONS.md item 28: comma-separated **provider-native** competition/league ids (API-Football's numeric league ids, or TheSportsDB's `idLeague` when that provider is selected) to scope `syncTodayFixtures` to. Read in `src/lib/football/competitions-config.ts` | Optional | Unset = no filter, every league the provider reports for the day still syncs (unchanged from before this item). Filters the already-fetched response rather than issuing one provider request per league — costs zero extra quota. |

## Automated live-sync worker (Vercel Cron) — added 2026-08-18

`src/app/api/cron/sync-live/route.ts` — the route itself is real and unconditionally ready to be scheduled. **Not currently wired to a schedule**: `vercel.json`'s `crons` array was removed 2026-08-18 because Vercel's Hobby (free) plan only permits daily cron jobs, and this route's design (fire every minute, decide internally whether anything's worth a provider call) needs the Pro plan's every-minute interval to work as intended — a Hobby deployment fails outright with the `* * * * *` entry present ("Hobby accounts are limited to daily cron jobs"). To reactivate once on a paid plan, add back to `vercel.json`:
```json
"crons": [{ "path": "/api/cron/sync-live", "schedule": "* * * * *" }]
```
The route decides on every firing whether anything is actually worth a provider call (live/halftime fixtures, or one kicking off within ~10 minutes) before it spends any quota. See `docs/LIVE_DATA.md` for the full checklist of what's real vs. still unverifiable about this worker.

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `CRON_SECRET` | Authorizes `/api/cron/sync-live` — the route rejects any request whose `Authorization: Bearer <value>` header doesn't match. Read in `src/app/api/cron/sync-live/route.ts` | **Required** for the cron route to ever do anything other than 500 | Vercel sets this automatically and sends it back as the Bearer token on every real Cron Jobs invocation once you add a Cron Job in the Vercel dashboard/`vercel.json` — see [vercel.com/docs/cron-jobs/manage-cron-jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs). Without it set, the route always returns 500 rather than silently accepting unauthenticated requests. |

This is genuinely new, real infrastructure — not just an env var read. `FOOTBALL_LIVE_POLLING_ENABLED` (above) is still the gate that decides whether the worker is allowed to spend any provider quota once it does run; `CRON_SECRET` only decides who's allowed to trigger the route at all. Setting `CRON_SECRET` alone does not turn on live polling.

## AI Copilot

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Powers the AI Copilot's grounded responses. Read in `src/lib/ai/client.ts` | Optional | Without it, `/ai` stays in its Coming Soon state — nothing breaks. When set, `/ai` and `src/app/api/ai/chat/route.ts` are fully live |
| `AI_MODEL` | Overrides the Claude model id used for Copilot responses. Read in `src/lib/ai/client.ts` | Optional | Defaults to `claude-sonnet-4-5` if unset |

---

## Reserved / not currently read by the app

These are declared in `.env.example` for a feature that's designed but not built yet. Setting them has no functional effect today. Confirmed by grepping every `process.env.` reference in `src/`.

| Variable | Purpose once built | Status |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | Would override the "KIVO" display name in metadata/UI | Not implemented — "KIVO" is hardcoded instead; setting this has no effect |
| `RESEND_API_KEY` | Transactional email (not auth — Clerk handles verification/reset emails itself) | Not wired — [resend.com](https://resend.com) |
| `RESEND_FROM_EMAIL` | Sending address for transactional email | Not wired — requires a verified sending domain before production |
| `WEBHOOK_SECRET` | Reserved for future non-Clerk webhook consumers | Not used — `CLERK_WEBHOOK_SECRET` is the only webhook secret actually read |

`CRON_SECRET` **used to be listed here** ("reserved, not used") — as of 2026-08-18 it's real; see the "Automated live-sync worker" section above, not this table.

---

## Local setup

1. `cp .env.example .env.local`
2. Fill in Clerk + Supabase values (both required to run the app at all).
3. Complete the manual Supabase↔Clerk dashboard step above.
4. `npm run dev`

Everything else (football provider, AI, email) is optional — the app degrades gracefully (Coming Soon states, mock data in dev) without them, by design.
