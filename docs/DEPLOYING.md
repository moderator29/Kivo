# Deploying KIVO

The sequence, in the order you will actually do it, with what to expect after
each step and what breaks if you skip it.

`ENVIRONMENT.md` is the reference — every variable, what it is, where to get
it. This is the walk-through. Read this one first and keep that one open.

Every claim below was checked against the code by grepping for `process.env`
rather than by reading documentation, and the failure modes in
[Appendix A](#appendix-a--every-environment-variable-and-what-breaks-without-it)
were reproduced against a real production build (2026-08-19).

---

## Before you start

Three things in hand:

- The Supabase project's three API keys (Dashboard → Project Settings → API).
- Access to the Supabase **SQL editor** — step 5 needs it, and there is no way
  to do that step from inside KIVO.
- An email address you can receive mail at. It becomes the first account, and
  it is the one you will make admin.

**Which Supabase project.** KIVO is already connected to
`gkyjfihxxdynfwqhhpyn` and all migrations are applied there. Do not create a
second project. If you ever do point KIVO at a fresh project, everything below
still applies, plus you must run `supabase/migrations/` in filename order
first — nothing in the app creates its own schema.

---

## Step 1 — Set the environment variables in Vercel

Project → Settings → Environment Variables. Set these for **Production** (and
Preview, if you use preview deployments).

**The four that must be right:**

| Variable | Where it comes from |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon/public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role (**secret** — server only, never `NEXT_PUBLIC_`) |
| `CRON_SECRET` | Invent one. A long random string. Vercel sends it back to KIVO as a bearer token on every scheduled call |

**Strongly recommended:**

| Variable | Why |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain`. Without it KIVO falls back to Vercel's own production URL, and if that is absent too, to `http://localhost:3000` — which is wrong in share links, canonical metadata, `sitemap.xml` and `robots.txt` for everyone but the machine running the server |
| `API_FOOTBALL_KEY` | Without it KIVO never gets a single fixture. Every football surface is a truthful empty state forever |

Everything else is genuinely optional. See
[Appendix A](#appendix-a--every-environment-variable-and-what-breaks-without-it).

> **`NEXT_PUBLIC_*` values are baked in at build time.** Saving a new value in
> the dashboard does **not** change an already-built deployment. After changing
> one, redeploy. This has bitten this project before.

---

## Step 2 — Deploy

Push, or hit Redeploy.

`vercel.json` already contains the daily cron entry — you do not need to add
it, and you should not edit that file:

```json
"crons": [{ "path": "/api/cron/sync-daily", "schedule": "0 5 * * *" }]
```

`0 5 * * *` is once a day, which is what the Hobby plan permits. An entry of
`* * * * *` fails Vercel's validation and blocks **every** deployment — that
cost hours once already.

---

## Step 3 — Check the deployment can reach the database

```
curl -s https://your-domain/api/health
```

Expect:

```json
{"status":"healthy","timestamp":"…","checks":{"database":"ok"}}
```

If you get `{"status":"unhealthy","checks":{"database":"unreachable"}}` with a
503, stop here. Either `SUPABASE_SERVICE_ROLE_KEY` is missing/wrong or the
Supabase project is not reachable. Nothing further in this list will work, and
several things will fail in ways that do not name this as the cause.

This endpoint is also the right URL to point an uptime monitor at.

---

## Step 4 — Sign in, and make sure the code email arrives

Go to `https://your-domain/sign-up` and enter your email.

**KIVO's only sign-in method is a six-digit code.** Supabase sends a *magic
link* by default and only sends a code if the Magic Link email template
contains `{{ .Token }}` (Supabase → Authentication → Email Templates). If you
receive a link instead of six digits, that template is the reason.

If no mail arrives at all, Supabase's built-in sender is rate-limited to a
handful of messages per hour. Fine for this step; not fine for real users —
see step 9 and `docs/EMAIL_DELIVERABILITY.md`.

You will land in onboarding. On an empty database it will ask for a username
and a notification preference and skip the club-picking steps entirely, because
there are no clubs to pick yet. That is correct behaviour, not a broken screen.

---

## Step 5 — Make yourself an admin

**This is the step with no in-product path, and the one most likely to be
missed.**

New accounts are created with `role = 'user'`, and row-level security
deliberately forbids an account from changing its own role — that is what stops
anyone self-provisioning as an admin. So the first admin has to be made from
outside the app, once.

Until you do this, visiting `/admin` silently redirects you to `/home`. There
is no error and no explanation. That is the expected behaviour of an
authorization check, and it is also exactly what it looks like when you have
forgotten this step.

Supabase → SQL editor:

```sql
-- Check you are looking at the right person first.
select p.username, p.role, u.email
from public.profiles p
join auth.users u on u.id = p.auth_user_id
order by p.created_at;

-- Then promote exactly that account.
update public.profiles p
set role = 'super_admin'
from auth.users u
where u.id = p.auth_user_id
  and u.email = 'you@example.com';
```

Sign out and back in, then open `/admin`. If the sidebar appears, this worked.

> `kivo_system` will also appear in that first query with no email — it is the
> author of automatic Match Room posts, it has no login, and it must stay that
> way. Never promote it.

---

## Step 6 — Run the first sync by hand

Admin → **Data Health** → **Sync now**.

This is the entry point for everything: it creates KIVO's competitions, teams,
venues and today's fixtures, each mapped to its provider id. Nothing else can
be synced until it has run once — a squad sync needs a team that has a provider
mapping, and a team only gets one from here.

That page carries the full ordered list (squads, standings, transfers, lineups)
and states what each one depends on. Follow it there rather than from here; it
is generated from the real guards in the sync code.

If the button refuses: `API_FOOTBALL_KEY` is not set. It refuses deliberately
rather than appearing to succeed against nothing.

---

## Step 7 — Confirm the scheduled sync actually runs

The daily cron is deployed and armed. Whether it *runs* is a different
question, and this project has twice shipped something that was built,
documented and then quietly never ran.

**Ask the product, not the config.** Admin → Data Health → *"Is data actually
arriving?"* reads real `sync_runs` rows and reports, per layer, whether it has
ever run. A layer that says **Never run** has never run, no matter what any
environment variable says.

If the daily layer says *Never run* more than 24 hours after deploying, test
the endpoint directly — the response tells you which of the causes it is:

```
curl -s -i https://your-domain/api/cron/sync-daily
```

| Response | Meaning | Fix |
| --- | --- | --- |
| `500 {"error":"CRON_SECRET is not configured"}` | The variable is not set on this deployment | Step 1, then redeploy |
| `401 {"error":"Unauthorized"}` | `CRON_SECRET` **is** set and you called without the token. This is the healthy answer to an unauthenticated curl | Nothing — the route is fine. If the schedule still never runs, the cron itself is not firing (check the Vercel dashboard's Cron tab and your plan) |
| `500 {"error":"SUPABASE_SERVICE_ROLE_KEY is not configured"}` | Only reachable with a valid token | Step 1, then redeploy |
| Anything else | Read the deployment's runtime logs | — |

To test the authorized path, send the token you set:

```
curl -s -i -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/sync-daily
```

---

## Step 8 — Optional: minute-by-minute live scores

**Skip this and you still get football data** — once a day from the cron, plus
an on-demand refresh whenever somebody opens a page whose data is already
stale. What you do not get is scores that move during a match.

Two Supabase Vault secrets plus one flag. Supabase → SQL editor:

```sql
select vault.create_secret('https://your-domain', 'kivo_app_base_url');
select vault.create_secret('<the same value as CRON_SECRET in Vercel>', 'kivo_cron_secret');
```

Then set `FOOTBALL_LIVE_POLLING_ENABLED=true` in Vercel and redeploy.

Read `ENVIRONMENT.md`'s "what turning on live polling actually costs" before
you do — it is bounded (at most ~55 provider requests in 24 hours, not 1,440),
and the reasoning matters if you are on a free tier.

---

## Step 9 — Optional, but do it before real users

| Step | Skip it and… |
| --- | --- |
| Custom SMTP (Supabase → Authentication → SMTP) | Sign-in codes are rate-limited to a handful per hour, project-wide. With email codes as the only way in, an email that does not arrive is a user who cannot use KIVO at all. Runbook: `docs/EMAIL_DELIVERABILITY.md` |
| `ANTHROPIC_API_KEY` | `/ai` stays an honest "Coming Soon". Nothing else is affected |
| Uptime monitor on `/api/health` | Nothing tells you the site is down except a person |

---

## What the morning after looks like

With everything above done and one sync run, expect this — none of it is a bug:

- **`/home`** leads with *"Follow a club and this page becomes yours"* until you
  follow one. Sections with nothing in them are not rendered at all rather than
  showing empty shells.
- **Browse pages** (`/teams`, `/leagues`, `/players`, `/venues`, `/transfers`)
  show *"nothing synced yet"* plus one line explaining that KIVO builds
  coverage one competition at a time. They stay that way for any competition
  the sync has not reached.
- **`/transparency`** counts what KIVO really holds. It is the fastest way to
  see whether a sync did anything.
- **Signed out, there is no product to see.** Every route under the app is
  behind sign-in by design; only `/`, `/about`, `/terms`, `/privacy`,
  `/support`, `/sign-in` and `/sign-up` are public.

The one thing that would be a bug: a browse page saying "nothing synced yet"
while `/api/health` reports unhealthy. That combination means a *failing*
read is being drawn as an *empty* one. See
[Appendix B](#appendix-b--empty-versus-broken).

---

## Appendix A — every environment variable, and what breaks without it

Compiled by grepping `process.env` across `src/`, `scripts/` and
`next.config.ts`. "Silent" means nothing in the product tells you.

### Required

| Variable | Missing → | Loud? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The session proxy falls through, every app and admin route redirects to `/sign-in`, and sign-in cannot send a code. Marketing pages still render | **Loud** — the app is a door you cannot open, though it never says why |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Identical to the above; both are required together | **Loud**, same caveat |
| `SUPABASE_SERVICE_ROLE_KEY` | Several things at once — see the breakdown below | **Mixed** |
| `CRON_SECRET` | Scheduled sync answers `500 {"error":"CRON_SECRET is not configured"}`, writes no `sync_runs` row, and Data Health reports "Never run" | Loud in the response, **silent in the product** |

**`SUPABASE_SERVICE_ROLE_KEY` in detail.** It is the widest-blast-radius
variable in the app, because ~34 call sites build a privileged client and the
constructor throws synchronously when the key is absent. Behaviour when it is
missing:

| Area | Effect |
| --- | --- |
| Rate limiting | **Fails open — every limit is off.** Deliberate (an infrastructure fault must not lock users out) and completely invisible |
| `/api/health` | 503 `database: unreachable`. Correct and loud |
| Scheduled sync | `500 {"error":"SUPABASE_SERVICE_ROLE_KEY is not configured"}`. Named explicitly since 2026-08-19; before that it was a bare 500 with no body |
| Fantasy roster carry-forward | Silently does not carry forward |
| Freshness notes | Read "Not synced yet" — indistinguishable from a genuinely fresh install |
| Likes, comments, follows | The write **succeeds**; the notification is skipped. Before 2026-08-19 the unhandled throw made the action *report failure after succeeding*, so a user would retry and undo work that had landed |
| Account deletion | Fails |
| Admin → Data Health | Throws |

### Optional, and what you give up

| Variable | Default | Missing → | Loud? |
| --- | --- | --- | --- |
| `API_FOOTBALL_KEY` | — | No football data, ever. Every football surface is an honest empty state; every sync button refuses to run rather than appear to succeed | **Loud** where it matters |
| `ANTHROPIC_API_KEY` | — | `/ai` shows Coming Soon; `/api/ai/chat` returns 503 | **Loud** |
| `AI_MODEL` | `claude-sonnet-4-5` | Fine unset. **A typo is worse than absence**: every AI reply fails and the UI says "temporarily unavailable", which is untrue — it is permanently misconfigured | **Silent until first use** |
| `NEXT_PUBLIC_APP_URL` | Vercel's production URL, then `http://localhost:3000` | Wrong canonical metadata, sitemap, `robots.txt` and share links. Also feeds the allow-list of origins a sign-in email may return to | Logs **once** on the server, otherwise silent |
| `FOOTBALL_DATA_PROVIDER` | `api-football` | Unrecognised values fall back to the default rather than failing the build | Fine |
| `THE_SPORTS_DB_API_KEY` | — | Only read when the provider is set to `thesportsdb`; if the provider is selected without the key, KIVO logs and falls back to API-Football rather than pretending | **Loud** in the server log |
| `FOOTBALL_IMAGE_HOSTS` | API-Football's host is built in | Crests from any other provider's CDN are blocked by the Content-Security-Policy. **Build-time value** — needs a redeploy, not just a save | **Silent** — broken images |
| `FOOTBALL_LIVE_POLLING_ENABLED` | off | The once-a-minute worker no-ops. Intended | Fine |
| `FOOTBALL_SYNC_COMPETITION_IDS` | unset | No filter; every league the provider returns for the day is synced | Fine |

### Set by the platform

`NODE_ENV`, `VERCEL_URL`, `VERCEL_BRANCH_URL`, `VERCEL_PROJECT_PRODUCTION_URL`.
Nothing to do.

### In `.env.example` but read nowhere in the code

`NEXT_PUBLIC_APP_NAME`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `WEBHOOK_SECRET`.
Reserved for features that are not built. Setting them does nothing.

---

## Appendix B — empty versus broken

KIVO distinguishes three states on purpose, and the difference is the whole
reason the empty states can be trusted:

- **"Nothing synced yet"** — the query succeeded and returned no rows.
- **"We could not find out"** — the query failed. Never drawn as empty.
- **"Coming soon"** — genuinely not built.

The browse index pages and the entity detail pages route their reads through
`readList`/`readRow` (`src/lib/query-result.ts`), so a failed read renders
*"could not find out"* rather than *"nothing synced yet"*. `docs/STATE_COVERAGE.md`
is the survey behind that.

**Known residual gap.** Roughly twenty pages — including `/home`, `/live`,
`/matches`, `/predictions`, `/fantasy`, `/profile`, `/saved`, `/notifications`
and the admin pages — still read with `data ?? []`, which collapses "the query
failed" into "there is nothing". On a genuinely empty database they render
correctly, so this does not affect first boot. It matters when something is
*broken*: those pages will tell you the database is empty when the truth is
that it is unreachable. If a page says "nothing synced yet" and `/api/health`
says unhealthy, believe `/api/health`.
