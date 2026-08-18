# KIVO — Environment Variables

Every variable KIVO reads, why it exists, and where to get it. Never commit real values — `.env.local` is gitignored; `.env.example` holds names only.

## Bringing real data online — what each key actually does the moment it's added

This is the plain-language version, audited 2026-08-15 by tracing every code path each variable gates end to end (see `src/lib/football/index.ts`, `src/lib/football/sync*.ts`, `src/app/admin/data-health/actions.ts`, `src/lib/ai/client.ts`, `src/app/api/ai/chat/route.ts`). No further code changes are needed for the first two — they're genuinely plug-and-play.

| Variable | The moment you paste it into Vercel and redeploy |
|---|---|
| `API_FOOTBALL_KEY` | **Instantly works.** `getFootballDataProvider()` switches from the dev-only mock straight to the real API-Football adapter — no other flag or step needed. Every sync path (today's fixtures, a team's squad, a fixture's lineups/events/stats, a season's standings, a player's transfer history) already calls the provider through that same one entry point, so all of them start hitting the real API immediately. On Admin → Data Health, the "Sync now" button and every per-item sync action already refuse to run without this key set (so nothing can silently "succeed" against mock data in production) — once it's set, those buttons trigger real syncs right away. Nothing hardcodes mock-only behavior anywhere in the sync layer. |
| `ANTHROPIC_API_KEY` | **Instantly works.** `isAiConfigured()` is the single gate checked by the `/ai` page (swaps from its Coming Soon state to the real chat UI) and by `/api/ai/chat` (returns a real streamed, grounded Claude response instead of a 503). There is no leftover stale/mock AI response anywhere — every code path that talks to Anthropic goes through `getAnthropicClient()`, which itself refuses to run without the key. |
| `THE_SPORTS_DB_API_KEY` | **Instantly works, but only if `FOOTBALL_DATA_PROVIDER=thesportsdb` is also set.** `getFootballDataProvider()` defaults to API-Football; TheSportsDB is a config-selectable alternative provider (`src/lib/football/providers/thesportsdb.ts`), not a fallback that activates automatically. See `docs/PROVIDER_ABSTRACTION.md` for what it does and doesn't support on the free tier. |

## ✅ No manual dashboard step is required any more

Until 2026-08-18 this section carried a warning that a founder-only, code-unreachable step had to be completed by hand before *any* RLS-gated query would work: registering Clerk as a Third Party Auth provider in the Supabase dashboard, so Supabase would trust Clerk-issued JWTs against Clerk's JWKS. Getting it wrong (or not doing it) rejected every authenticated read and write, with all env vars set correctly and no error that pointed at the cause.

**That step is gone.** Supabase Auth now issues the JWTs that Supabase itself verifies — there is no cross-vendor trust to configure, so there is nothing to click in either dashboard, and nothing that can drift out of sync between two providers. The keys in the Supabase section below are the whole of it.

The one setting that *is* worth checking, because it changes what the user receives rather than whether auth works at all: Supabase Auth sends a **Magic Link** by default and only sends a six-digit code if the Magic Link email template contains `{{ .Token }}` (Dashboard → Authentication → Email Templates). KIVO's sign-in is code-entry only, so that template must include the token. This is a content choice, not a trust relationship — a wrong template sends a link instead of a code; it cannot silently reject authenticated queries the way the old Clerk step could.

## ⚠️ Changing a Supabase key? Still trigger a brand-new Vercel deployment

`NEXT_PUBLIC_*` variables are baked into the build output by Next.js, not read fresh at runtime — saving a new value in the Vercel dashboard does **not** change an already-built deployment. After changing `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`, trigger an actual new deployment ("Redeploy" on the latest deployment, or push a commit).

This warning used to be much sharper, and specific to Clerk: `next.config.ts` decoded `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` at build time to compute the CSP's Clerk allowlist, so a key change without a rebuild left the CSP allowing the *previous* Clerk host — sign-up appeared to work, the code email arrived, and submitting it silently did nothing because the browser blocked the verification call. **That failure mode no longer exists.** `next.config.ts` derives nothing from an auth key any more; the only origin in the CSP is `NEXT_PUBLIC_SUPABASE_URL`, and a stale value there fails loudly (every request to the wrong project errors) rather than only breaking the last step of sign-in.

---

## App

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Canonical app URL, used for OG metadata / absolute links. Read in `src/app/layout.tsx`, `src/app/robots.ts`, `src/app/sitemap.ts` | Optional | Defaults to `http://localhost:3000` in dev |

`NEXT_PUBLIC_APP_NAME` also appears in `.env.example` but is not read anywhere in `src/` today — see "Reserved / not currently read by the app" below.

## Supabase — identity, authentication, and application data

As of 2026-08-18 these three keys are the app's entire backend and identity configuration. There is no separate auth provider to key, and no fourth key to add later for sign-in.

| Variable | Purpose | Required | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL — serves REST, Storage **and** Auth (`/auth/v1/otp`, `/auth/v1/verify`) | **Required** | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key — RLS-gated, safe client-side; also the key the browser uses to request and redeem a sign-in code | **Required** | Supabase Dashboard → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS — server-only, trusted contexts only (admin mutations, `auth.admin.deleteUser` on account deletion) | **Required**, server-only | Supabase Dashboard → Project Settings → API |

Current project: `gkyjfihxxdynfwqhhpyn` (already connected — do not create a second project).

Sign-in method: **email one-time code only** (see `DECISIONS.md`, 2026-08-18). No password, no social provider. X/Google/Apple remain architected-for but are not enabled — enabling one is a dashboard provider toggle plus a sign-in button, not a re-platforming.

### Sending the sign-in email in production

Supabase's built-in email sender is intended for development and is heavily rate-limited (a handful of messages per hour per project, shared across every auth email). It is fine for local work and for testing, and it is **not** adequate for real signups. Before production traffic, configure custom SMTP under Dashboard → Project Settings → Authentication → SMTP Settings; `RESEND_API_KEY` below is the intended sender once that is wired. Nothing in the code changes when you do this — Supabase sends the mail either way.

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
| `RESEND_API_KEY` | Transactional email. Note this is **not** the sign-in email: Supabase Auth sends the OTP itself, either through its own rate-limited built-in sender or through custom SMTP configured in the Supabase dashboard (see above). Wiring Resend here would be for KIVO's own product email | Not wired — [resend.com](https://resend.com) |
| `RESEND_FROM_EMAIL` | Sending address for transactional email | Not wired — requires a verified sending domain before production |
| `WEBHOOK_SECRET` | Reserved for a future inbound webhook consumer | Not used. `CLERK_WEBHOOK_SECRET` used to be the one webhook secret actually read; the Clerk webhook route was deleted 2026-08-18 along with the rest of Clerk, so the app reads no webhook secret at all today |

`CRON_SECRET` **used to be listed here** ("reserved, not used") — as of 2026-08-18 it's real; see the "Automated live-sync worker" section above, not this table.

---

## Local setup

1. `cp .env.example .env.local`
2. Fill in the three Supabase values (required to run the app at all).
3. `npm run dev`

Step 3 used to be "complete the manual Supabase↔Clerk dashboard step above". It no longer exists — a fresh checkout goes from three pasted keys to a working, signed-in app with nothing to configure by hand in either dashboard.

Everything else (football provider, AI, email) is optional — the app degrades gracefully (Coming Soon states, mock data in dev) without them, by design.
