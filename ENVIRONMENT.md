# KIVO — Environment Variables

Every variable KIVO reads, why it exists, and where to get it. Never commit real values — `.env.local` is gitignored; `.env.example` holds names only.

> **Deploying for the first time? Read `docs/DEPLOYING.md` first, and keep this open beside it.** This file is the reference — one entry per variable. That one is the sequence: what to do, in the order you will do it, what to expect after each step, and which steps are optional. It also carries the step that appears nowhere in this file and nowhere in the product — **making your own account an admin**, which cannot be done from inside KIVO, and without which `/admin` silently redirects you to `/home`.

---

## ⚠️ Waiting on you right now (2026-08-18)

Football data now arrives three different ways. **One of them needs nothing and is already live; two are built, deployed and waiting on a single action each.** They are listed here at the top rather than buried below because the same failure has happened twice on this project: something is built, documented and deployed, and then quietly never runs.

**You do not have to take anything on trust.** Admin → Data Health now has an "Is data actually arriving?" panel that reads real sync rows and says, per layer, whether it has *ever actually run* and what the one remaining step is. If a layer says "Never run", it has never run — regardless of what any environment variable says.

| | Needs from you | Effect |
|---|---|---|
| **On-demand freshness** | Nothing — live on the next deploy of the current code | A page load on stale data triggers a sync after the response. Not live scores |
| **Daily baseline** | ~~Paste the `crons` block below into `vercel.json`~~ — **already committed and verified 2026-08-19.** What it still needs is `CRON_SECRET` set in Vercel | Fixtures, clubs, competitions and five league tables, once a day |
| **Once-a-minute worker** | Two Supabase Vault secrets + `FOOTBALL_LIVE_POLLING_ENABLED=true` | Real live scores |

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/sync-daily",
      "schedule": "0 5 * * *"
    }
  ]
}
```

```sql
-- Supabase dashboard → SQL editor. Arms the once-a-minute worker's scheduler,
-- which is already running and deliberately doing nothing until these exist.
select vault.create_secret('https://<your-kivo-domain>', 'kivo_app_base_url');
select vault.create_secret('<the same value as CRON_SECRET in Vercel>', 'kivo_cron_secret');
```

**`vercel.json` already contains exactly the `crons` block shown further up** — there is nothing to paste; it is reproduced here so you can confirm what is deployed. **What it still needs from you is `CRON_SECRET`.** Without it KIVO itself rejects the scheduled call with `500 {"error":"CRON_SECRET is not configured"}`, writes no `sync_runs` row, and Data Health reports "Never run" — which is true, and looks identical to the cron never having been deployed. `docs/DEPLOYING.md` step 7 has the one curl that tells those apart.

`0 5 * * *` is **once a day**, which is what the Hobby plan permits — the entry that previously blocked every deployment was `* * * * *`. Full detail in "How football data arrives" below, and in `docs/LIVE_DATA.md`.

---

## Bringing real data online — what each key actually does the moment it's added

This is the plain-language version, audited 2026-08-15 by tracing every code path each variable gates end to end (see `src/lib/football/index.ts`, `src/lib/football/sync*.ts`, `src/app/admin/football/actions.ts`, `src/lib/ai/client.ts`, `src/app/api/ai/chat/route.ts`). No further code changes are needed for the first two — they're genuinely plug-and-play.

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

Sign-in method: **email + password**, with an emailed six-digit code as a secondary route and `/forgot-password` for recovery (see `DECISIONS.md`, 2026-08-19 — this reversed the 2026-08-18 passwordless design). No social provider. X/Google/Apple remain architected-for but are not enabled — enabling one is a dashboard provider toggle plus a sign-in button, not a re-platforming.

One dashboard setting now matters that did not before: **Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords"**. It is off on the live project and cannot be switched on from code. `docs/DEPLOYING.md` step 9 has the reasoning.

### Sending the sign-in email in production

Supabase's built-in email sender is intended for development and is heavily rate-limited (a handful of messages per hour per project, shared across every auth email). It is fine for local work and for testing, and it is **not** adequate for real signups. Before production traffic, configure custom SMTP under Dashboard → Project Settings → Authentication → SMTP Settings; `RESEND_API_KEY` below is the intended sender once that is wired. Nothing in the code changes when you do this — Supabase sends the mail either way. **`docs/EMAIL_DELIVERABILITY.md` is the full runbook** (KN-117): which DNS records to publish and why, the rate-limit setting that stays in force even after custom SMTP is wired, what to test against which mailboxes, and the bounce/complaint path. With email OTP as the only sign-in method, an email that doesn't arrive is a user who cannot use KIVO at all — read that before launch, not after the first report.

## Football data — provider abstraction (see `DECISIONS.md`)

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `BBS_API_KEY` | **Big Balls Sports Data** — the primary football provider from 2026-08-19. Base URL `https://api.bigballsdata.com`, sent as `Authorization: Bearer <key>`. | Optional today, primary once the adapter lands | **Server-only. Never `NEXT_PUBLIC_`.** A provider key in a client bundle is a key every visitor can read and spend, and there is no way to un-ship one. Nothing in KIVO reads this variable from client code, and nothing should. **Not verifiable from this build environment:** `api.bigballsdata.com` is blocked by the egress proxy every session here runs behind, so no request to it has ever been made and its rate-limit headers and published limits have never been read. KIVO therefore applies its own conservative pace (see `provider_request_burst_limit` in migration 0118) rather than a number nobody could check. |
| `FOOTBALL_DATA_API_KEY` | **football-data.org v4** — the secondary provider. Base URL `https://api.football-data.org/v4`, sent as `X-Auth-Token: <key>`. | Optional | **Server-only. Never `NEXT_PUBLIC_`,** same reasoning as above. Also unreachable from this build environment, and budgeted the same conservative way for the same reason. |
| `API_FOOTBALL_KEY` | API-Football key (free tier for MVP — $0 budget, see DECISIONS.md). Read in `src/lib/football/index.ts` and `src/app/admin/football/*` | Optional | [dashboard.api-football.com](https://dashboard.api-football.com) — without this, a development-only mock provider is used automatically (never in production) |
| `THE_SPORTS_DB_API_KEY` | TheSportsDB v1 API key, embedded in the request path (not a header) by `src/lib/football/providers/thesportsdb.ts`. Read only when `FOOTBALL_DATA_PROVIDER=thesportsdb` | Optional | [thesportsdb.com/free_sports_api](https://www.thesportsdb.com/free_sports_api) (Patreon key at [patreon.com/thesportsdb](https://www.patreon.com/thesportsdb) for the v2/premium tier — not used here) — see `docs/API_FOOTBALL.md` and `docs/PROVIDER_ABSTRACTION.md` for real free-tier coverage/limits |
| `FOOTBALL_DATA_PROVIDER` | Selects which provider `getFootballDataProvider()` returns: `api-football` (default) or `thesportsdb`. Read in `src/lib/football/index.ts` | Optional, default `api-football` | Any other/unrecognized value falls back to `api-football` rather than failing the build |
| `FOOTBALL_IMAGE_HOSTS` | Extra image CDN hostnames to allow, comma-separated bare hostnames (e.g. `r2.thesportsdb.com`). Read at build time in `next.config.ts` via `src/lib/football/image-hosts.ts`, which feeds **both** `images.remotePatterns` and the CSP `img-src` directive from one list so they cannot drift apart. | Optional | **Set this whenever you set `FOOTBALL_DATA_PROVIDER=thesportsdb`.** API-Football's host (`media.api-sports.io`) is built in and verified. TheSportsDB's image host is not, deliberately: thesportsdb.com is unreachable from every sandbox this repo has been built in, so the hostname its badge URLs resolve to has never been read off a real response, and hardcoding a guess would be an unverified claim (and a wrong one degrades to a broken crest on every row). Read the host off one real `strBadge`/`strTeamBadge` URL and set it here. Scheme, port, path and wildcard entries are rejected with a build-log warning and ignored — this value lands verbatim in a security header. **`next.config.ts` is read at build time, so a change needs a fresh deployment, not just a saved env var.** |
| `FOOTBALL_LIVE_POLLING_ENABLED` | Feature flag, read in `src/lib/football/index.ts`. Gates the once-a-minute worker | Optional, **default off** | **Turning it on costs at most 55 provider requests in any 24 hours, not 1,440.** See "What turning on live polling actually costs" below before deciding |
| `FOOTBALL_SYNC_COMPETITION_IDS` | Comma-separated **provider-native** competition/league ids (API-Football's numeric league ids, or TheSportsDB's `idLeague` when that provider is selected) to scope `syncTodayFixtures` to. Read in `src/lib/football/competitions-config.ts` | Optional | **Unset now means KIVO's shipped default list**, not "no filter". That changed because unfiltered was measured against a live account and produced 85 competitions of youth, reserve and third-division football and not one club anybody would look for — a pipeline that only creates clubs from *today's fixtures* produces a database of whoever kicked off. The default is seven major competitions whose API-Football ids KIVO could establish with certainty; every id is displayed on Admin → Data Health beside the name and country the **provider itself** returns for it, so a wrong id is visible rather than silent. Set this to `all` for the old no-filter behaviour, or to your own comma-separated ids to override. Filters the already-fetched response rather than issuing one request per league — costs zero extra quota either way. Applies only to API-Football when unset: the default list is API-Football's numbering and would mean something else under another provider's ids, so any other provider gets no filter rather than an invented one. |
| `FOOTBALL_TARGET_SEASON` | The season **starting year** KIVO asks the provider for (2024 = the 2024/25 season). Read in `src/lib/football/target-season.ts`, which every season-scoped sync now resolves through. | Optional, default = the calendar season | **Set this (or the database override on Admin → Data Health, which wins over it) if your API-Football plan does not cover the current season.** A free plan refuses every season-scoped endpoint outright — the provider's own recorded words are "Free plans do not have access to this season, try from 2022 to 2024" — and those refusals arrive as HTTP 200 with an `errors` body, so they read downstream as empty tables rather than as errors. The endpoints that carry no season parameter (`/fixtures?date=`, `/players/squads?team=`, `/coachs?team=`, `/fixtures/{lineups,events,statistics,players}?fixture=`, `/transfers?player=|team=`) are unaffected either way. Must be a bare four-digit year; anything else is logged and ignored rather than coerced. **The default deliberately stays the real current season** — KIVO must never quietly show a two-year-old season, so every surface that reads an override says which year it got and where the year came from. |
| — (no env var) | **The Nigeria Professional Football League is deliberately NOT in the default list.** Its API-Football league id could not be established with certainty from this build environment, and a wrong league id does not fail loudly — it quietly syncs a different country's league. To add it: run Admin → Data Health → "Refresh coverage registry" (one request, returns every league the plan can see with its name and country), find the Nigerian league in the club-catalogue panel's registry, then set `FOOTBALL_SYNC_COMPETITION_IDS` to the default ids plus that one. | — | — |

## How football data arrives — three layers, only one of them is live scores

Founder instruction, 2026-08-18: "Make it automatic — no need for triggering now." Nothing needs pressing any more, but the three mechanisms are genuinely different and it matters which is which.

| Layer | Cadence | What you need to do | Keeps fresh |
|---|---|---|---|
| **On-demand** (`src/lib/football/auto-sync.ts`) | When somebody loads `/home`, `/matches` or `/live` and the data is stale | **Nothing** — already live | Everything, eventually. The visitor who triggers it sees the old data; the next one sees the new data. A quiet site refreshes nothing |
| **Daily baseline** (`/api/cron/sync-daily`) | Once a day, 05:00 UTC | **Paste six lines into `vercel.json`** — see immediately below. The route is built and deployed; only the schedule is missing | Today's fixtures and the clubs/competitions they create, plus five league tables a day |
| **Once-a-minute worker** (`/api/cron/sync-live`) | Every minute | Two Vault secrets **and** `FOOTBALL_LIVE_POLLING_ENABLED=true` (below) | Live scores. Only this row is live scores |

### FOUNDER: what turning on live polling actually costs

Short answer: **at most 55 provider requests in any rolling 24 hours, and on most days far fewer.** Not 1,440. You can weigh that against the free tier's ~100/day with a real number rather than a shrug.

The worker fires every minute, and firing is not spending. It spends only when all of these are true, and the last one is the interesting part:

1. `FOOTBALL_LIVE_POLLING_ENABLED=true`, and a provider key is configured.
2. Something is genuinely in play, or kicks off within 10 minutes. **No live football means zero requests** — which is most hours of most weeks.
3. No other sync currently holds the fixtures lease.
4. It is time yet, by a pace the worker derives rather than one anybody configured.

That fourth point is what makes 55 enough. The worker divides its remaining allowance by the minutes of live football still to cover, so the budget is spread across the day's football instead of across the clock:

| Situation | Roughly one refresh every |
|---|---|
| A single 3-hour matchday | 3.3 minutes |
| A heavy 8-hour Saturday across leagues | 8.7 minutes |
| Nothing in play | never — zero requests |

It tightens to half that pace in the minutes when a scoreline actually moves (the opening exchanges, the approach to half-time, the last ten and added time), and widens by half again when nothing has changed since the last look. Tightening stops once 75% of the allowance is gone, so a frantic early kick-off cannot eat the evening's football.

**The allowance is enforced, not documented.** Every automated request is reserved through an atomic database consume (`consume_provider_requests`, migration 0091) whose ceiling lives in the database, not in the calling code. If the reservation is refused, no provider call is made at all. Three separate allowances, and none can borrow from another:

| Bucket | Allowance / 24h | What it is |
|---|---|---|
| `live` | 55 | The once-a-minute worker |
| `auto` | 20 | On-demand freshness when somebody opens a football page on stale data |
| `daily` | 8 | The daily baseline: fixtures plus a few league tables |
| **unbudgeted** | **~17** | **Yours.** Admin "Sync now" spends from here, and no automated path can reach it |

The window is a rolling 24 hours rather than a calendar day, deliberately: KIVO cannot establish when API-Football's own counter resets, and a trailing cap of 55 means at most 55 in *any* 24-hour period, including whatever day boundary the provider actually uses.

**What you can see.** Admin → Data Health has a "Live worker" panel showing spend per bucket over the last 24 hours, the provider's own reported remaining count, when the worker last ran, and — in plain English — why it is idle right now ("nothing is in play", "next refresh in 3.2 minutes", "the allowance is used up").

**What happens when the allowance runs out.** Refreshes pause and `/live` says so: "Automatic refreshes have paused — today's update allowance is used up, so these scores may be behind the real ones." A stale score that says it might be stale is honest; a frozen one presented as live is not.

**One thing that is NOT gated behind this flag, and is spending quota today.** On-demand freshness (`auto`, the table above) fires from ordinary page views, right now, with this flag off. Before this pass it had a three-minute cooldown and no daily limit at all, which permitted up to 480 requests a day — nearly five times the whole tier. It now has the 20-request allowance above. Nothing had actually hit the old ceiling because nothing has driven that much traffic yet, but it was a bound that did not exist rather than a bound that was generous.

**What could not be tested.** This sandbox has no route to api-football.com, so the budget arithmetic, the pacing and the refusal behaviour are unit-tested (`live-sync-planner.test.ts`, `auto-sync.test.ts`) and the live behaviour is not. Nobody here has watched a real match refresh. The first real matchday is the real test, and the Data Health panel is what to watch it on.

### FOUNDER: the one paste that turns on the daily baseline

`vercel.json` is deployment configuration, so this session deliberately did not edit it — that file is yours. The route it points at (`/api/cron/sync-daily`) is built, deployed and waiting. Add the `crons` array:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/cron/sync-daily",
      "schedule": "0 5 * * *"
    }
  ]
}
```

Three things about that block, each one a thing that broke a deploy or could:

- **`0 5 * * *` is once a day**, which is what the Hobby plan permits. The entry that previously blocked every deployment was `* * * * *` against `/api/cron/sync-live`. Do not point a sub-daily schedule at anything while on Hobby.
- **The path has no query string.** Vercel's cron documentation only ever shows a bare path; that is why the daily behaviour lives at its own route rather than as `?mode=daily` on the live one.
- **`CRON_SECRET` must be set in Vercel** or the route answers 500 rather than accepting unauthenticated requests. Vercel sends it back as a Bearer token on every cron invocation.

Nothing about this starts spending live-polling quota: this route makes one fixtures call plus at most five standings calls, once a day, against a 100-a-day free tier.

Full reasoning: `docs/LIVE_DATA.md` and `DECISIONS.md` ("Automated sync trigger").

## Automated live-sync worker — scheduled from Supabase since 2026-08-18

`src/app/api/cron/sync-live/route.ts` is the worker. It now has a real caller: **Supabase `pg_cron`**, firing once a minute (migration `0067_scheduled_live_sync_trigger.sql`). Vercel Cron is not it — the Hobby plan permits daily crons only and a more frequent expression fails the deployment outright, so `vercel.json`'s `crons` array was removed. See `DECISIONS.md` (2026-08-18, "Automated sync trigger") for why `pg_cron` beat GitHub Actions and an external pinger.

**The schedule is live and doing nothing, on purpose.** `private.trigger_live_sync()` reads two secrets from Supabase Vault on every fire and returns immediately if either is missing. Adding them is the whole activation step — no code change, no deployment:

```sql
-- Supabase dashboard -> SQL editor (or Project Settings -> Vault)
select vault.create_secret('https://<your-kivo-domain>', 'kivo_app_base_url');
select vault.create_secret('<the same value as CRON_SECRET in Vercel>', 'kivo_cron_secret');
```

`kivo_cron_secret` must match Vercel's `CRON_SECRET` exactly, or the route answers 401 and nothing syncs.

**Adding these does not start spending provider quota.** `FOOTBALL_LIVE_POLLING_ENABLED` and `API_FOOTBALL_KEY` are still the gates that decide whether the worker may make a provider call at all; these two secrets only change it from *never asked* to *asked once a minute*.

- Watch it: `select * from cron.job_run_details order by start_time desc limit 20;`
- Pause it: `select cron.unschedule('kivo-live-sync');`
- Rotate the secret: edit the Vault entry and the Vercel env var. No migration, no redeploy — the function reads it fresh on every fire.

The route decides on every firing whether anything is actually worth a provider call (live/halftime fixtures, or one kicking off within ~10 minutes) before it spends any quota. See `docs/LIVE_DATA.md` for the full checklist of what's real vs. still unverifiable about this worker.

If KIVO ever moves to a paid Vercel plan, prefer unscheduling this rather than running both — two schedulers calling the same worker would depend entirely on the sync lease to stay correct.

| Variable | Purpose | Required | Notes |
|---|---|---|---|
| `CRON_SECRET` | Authorizes `/api/cron/sync-live` — the route rejects any request whose `Authorization: Bearer <value>` header doesn't match. Read in `src/app/api/cron/sync-live/route.ts` | **Required** for the cron route to ever do anything other than 500 | Set it yourself in Vercel to any long random string, and put the **same** value in Supabase Vault as `kivo_cron_secret` (above). Vercel also populates this automatically for its own Cron Jobs, but KIVO's scheduler is Supabase's, so the value has to be one you chose and can copy into both places. Without it set, the route always returns 500 rather than silently accepting unauthenticated requests. |

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

## Uptime monitoring — `/api/health` (founder step, five minutes)

`src/app/api/health/route.ts` exists and answers honestly: `200` with
`{"status":"healthy","checks":{"database":"ok"}}` when the app can actually
reach Supabase, `503` with `"database":"unreachable"` when it cannot — including
when `SUPABASE_SERVICE_ROLE_KEY` is missing, because an app that cannot reach
its database is unhealthy whatever the reason.

**Nothing calls it.** (KIVO_NEXT_GEN.md KN-135.) That is not a code gap — it
needs an account somewhere, which no Claude Code session can create. Until a
monitor is pointed at it, KIVO finds out it is down the same way it does today:
somebody opens the app.

To close it, point any HTTP monitor at `https://<your-domain>/api/health`:

- **Interval**: 1–5 minutes. The check is a single indexed `select id ... limit
  1`, so it is cheap enough to run often and expensive enough to be meaningful.
- **Alert on**: any non-`200`. Do *not* alert on response body text — alert on
  the status code, and read the body for the reason.
- **Suggested services**: Better Stack, Checkly, UptimeRobot, or Vercel's own
  Monitoring. Any of them works; none of them is wired here, and this document
  will not pretend otherwise.

The response shape is a contract a monitor depends on, so it is covered by a
test (`src/app/api/health/route.test.ts`) rather than left to be quietly
renamed — a monitor that silently stops understanding the body is worse than no
monitor, because it reports success.

---

## Local setup

1. `cp .env.example .env.local`
2. Fill in the three Supabase values (required to run the app at all).
3. `npm run dev`

Step 3 used to be "complete the manual Supabase↔Clerk dashboard step above". It no longer exists — a fresh checkout goes from three pasted keys to a working, signed-in app with nothing to configure by hand in either dashboard.

Everything else (football provider, AI, email) is optional — the app degrades gracefully (Coming Soon states, mock data in dev) without them, by design.
