# KIVO — Deployment

How KIVO gets from a commit to a running product, what only the founder can do, and how to tell — from inside the app — whether it actually worked.

**Deployment is the founder's alone.** No agent or engineer touches Vercel configuration, environment variables or `vercel.json`. This document describes the process; it does not perform it.

---

## 1. Shape

| | |
|---|---|
| Host | Vercel |
| Framework | Next.js 16, App Router, Turbopack |
| Runtime | Node 22 (pinned in `package.json` `engines`, matched by CI) |
| Database, auth, storage, realtime | Supabase (project `gkyjfihxxdynfwqhhpyn`) |
| Scheduling | Vercel Cron (daily) + Supabase `pg_cron` + `pg_net` (per-minute) |
| Branch | `claude/kivo-master-build-2qijfs`. `main` is never pushed to. |

There is no staging environment. There is one Supabase project, shared by local development and the deployed app — which is why a destructive migration is a bigger decision here than it would be with a disposable staging database.

---

## 2. The gate every change passes

Locally, and again in CI (`.github/workflows/ci.yml`) on every push to every branch:

```bash
npx tsc --noEmit    # npm run typecheck
npx eslint .        # npm run lint
npm test            # vitest run
npm run build
npm run check:assets
```

`check:assets` exists because `next build` never resolves a string path into `public/` — a renamed or deleted asset is just a string until a user's browser asks for it and gets a 404. It is the one check that catches a class of bug the compiler structurally cannot.

### Verify against committed HEAD, not the working tree

This has broken the branch before, so it is a rule rather than advice. A local build passes with half a change uncommitted, because the uncommitted half is on disk. Verify in a detached worktree of the commit you are about to push:

```bash
git worktree add --detach ../kivo-verify HEAD
cp -al node_modules ../kivo-verify/node_modules   # hardlinks: fast, and no duplicate 769MB
cp .env.local ../kivo-verify/
cd ../kivo-verify && npx next build
```

Hardlink `node_modules` rather than symlinking it: Turbopack refuses a symlink that points outside the project root, with a panic that reads like a compiler bug and is not one.

---

## 3. Migrations

Files in `supabase/migrations/`, applied to the live project. Two sources of truth that must agree, and a discipline that exists because they have disagreed:

1. **Before creating a migration**, check both `supabase/migrations/` *and* the live migration list. This branch has had genuine number collisions, and a filename check alone is not enough because two agents can pick the same next number minutes apart.
2. **Before applying**, check again. The gap between deciding a number and using it is where the collision happens.
3. **After any schema change**, run the security advisors. A recreated function silently loses its grants — that has happened here, and it briefly left a function callable unauthenticated.

**A migration file is never edited after it is applied.** A mistake gets a new migration that corrects it, and the original stays exactly as it ran. `0033` corrects `0032`, `0058` corrects `0057`, `0063` corrects `0060`, `0093` corrects `0092`. Reading that sequence tells you what actually happened; rewriting history would not.

Every migration carries a "To reverse:" block. Some of them say the reversal is not possible (a Postgres enum label cannot be dropped), which is the honest answer.

---

## 4. What only the founder can do

Nothing in this list is reachable from a development session. If a session reports "the APIs aren't live", this is almost always why.

### 4.1 Environment variables

Set in Vercel, then **trigger a fresh deployment**. Saving a variable is not enough — `NEXT_PUBLIC_*` values and some server config are baked in at build time. This is a real footgun that has been hit before.

| Variable | Required | Effect |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only. Sync, notifications, scoring. |
| `API_FOOTBALL_KEY` | No | Football data goes real immediately. No other flag. |
| `ANTHROPIC_API_KEY` | No | `/ai` goes from Coming Soon to real, streamed, grounded. |
| `THE_SPORTS_DB_API_KEY` | No | Only with `FOOTBALL_DATA_PROVIDER=thesportsdb`. |
| `FOOTBALL_DATA_PROVIDER` | No | Defaults to API-Football. |
| `FOOTBALL_LIVE_POLLING_ENABLED` | No | Arms the per-minute live worker. |
| `FOOTBALL_SYNC_COMPETITION_IDS` | No | Bounds what the daily sync pulls. Unset uses KIVO's shipped default list; `all` disables the filter. |
| `CRON_SECRET` | For cron | Bearer token both cron routes require. |
| `NEXT_PUBLIC_APP_URL` | No | Absolute URLs in emails and share cards. |
| `AI_MODEL` | No | Overrides the default model id. |

### 4.2 Supabase Vault, for the per-minute worker

The `pg_cron` job runs every minute already and deliberately does nothing until these exist. No deploy needed once they do.

```sql
select vault.create_secret('https://<your-kivo-domain>', 'kivo_app_base_url');
select vault.create_secret('<the same value as CRON_SECRET in Vercel>', 'kivo_cron_secret');
```

### 4.3 Custom SMTP

Before real signups. Supabase's built-in sender delivers the code but is rate-limited to a handful of messages per hour per project — fine for testing, not for launch.

### 4.4 The email template

Supabase Auth sends a Magic Link by default and only sends a six-digit code if the template contains `{{ .Token }}`. KIVO's sign-in is code-entry only. A wrong template sends a link where the UI expects a code.

---

## 5. Verifying it actually worked

**Do not trust this document, or any status report, about whether data is arriving.**

Admin → Data Health has an *"Is data actually arriving?"* panel that reads real `sync_runs` rows and says, per layer, whether it has **ever actually run**. If it says "Never run", it has never run, regardless of what any environment variable claims.

That panel exists because "built, documented, deployed, and quietly never running" has happened twice on this project. It is the only source of truth for this question.

Also worth checking after a deploy:

- `GET /api/health` — process liveness.
- Admin → Data Health → sync reliability — failure counts and unreviewed data anomalies.
- Supabase advisors — security and performance, after any migration.

---

## 6. Rollback

- **Code**: redeploy the previous Vercel deployment. Instant, and it does not touch the database.
- **Schema**: apply the "To reverse:" block from the migration. Not automatic, deliberately — an automatic down-migration on a shared database with one environment is more dangerous than a careful manual one.
- **Data**: Supabase's own backups. Restore procedure in `docs/BACKUP_RESTORE_AND_SEED.md`.

A code rollback across a schema change is the case to think about before deploying, not after: the previous build may not know about a new NOT NULL column. Every migration in this project is additive or defaulted for exactly that reason.

---

## 7. Known gaps

| Gap | Consequence |
|---|---|
| No staging environment | Migrations are validated against the production database. Mitigated by additive-only migrations and live verification on throwaway rows that are then deleted. |
| One Supabase project | Local development shares production data. |
| No automated E2E suite | A real unit suite (854 tests as of 2026-08-19) and no browser-level regression suite. UI is verified by screenshot at 390px in both themes. |
| No error tracking service | Errors go through `logError` to the platform log. No Sentry, no aggregation, no alerting. |
| No dependency scanning in CI | — |
| Vercel Hobby plan | Cron is limited to daily. The per-minute worker exists because of that limit, not despite it. |
