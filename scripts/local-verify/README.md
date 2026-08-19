# Running KIVO against a database, locally

Until this existed, nothing in this repository had ever been run against data.
The test suite is 900-odd unit tests over pure functions; the live database has
no football in it and one real account; and every claim about what the product
does when a match is in play, or when a squad has been picked, or when a
competition covers less than another, was reasoning rather than observation.

This is the missing half: a throwaway Postgres with the real schema, a seeded
league, and a Supabase-shaped API in front of it, so the actual application —
unmodified, with real RLS — can be pointed at something and watched.

---

## What it is, precisely

| Piece | What it does |
|---|---|
| `00_supabase_shim.sql` | The platform layer a Supabase project supplies and stock Postgres does not: the anon/authenticated/service_role roles and their default grants, `auth` and `storage`, `vault`, the Realtime publication |
| `replay.sh` | Drops the database and replays **every** migration in `supabase/migrations/` in filename order |
| `10_scenario.sql` | The half `supabase/seed.sql` deliberately omits — people, squads, rooms — plus the cases that break things |
| `rebuild.sh` | replay + `supabase/seed.sql` + scenario, in one command |
| `server/` | A PostgREST subset and the slice of GoTrue KIVO's sign-in uses, over the same database |
| `start.sh` | Starts that server and writes `.env.local-verify` |
| `dev.sh` | Runs `next dev` against it |
| `drive/` | Scripts that exercise the product and assert what came back |

**RLS is real here.** Every request the shim serves runs inside a transaction
that does `set local role` and sets `request.jwt.claims` from the caller's
token, exactly as PostgREST does. A query it allows is a query the live
database would allow, and `drive/rls.ts` is a check of the policies rather than
of the UI.

---

## Running it

```bash
npm install --prefix scripts/local-verify      # pg + jose, kept out of the app's tree
pg_ctlcluster 16 main start                    # or however Postgres starts here

bash scripts/local-verify/rebuild.sh           # schema + seed + scenario
bash scripts/local-verify/start.sh             # the API, on :54321
KIVO_DEV_DIR=/path/to/a/worktree bash scripts/local-verify/dev.sh   # the app, on :3100
```

`dev.sh` takes a directory because Next refuses two dev servers in one
checkout, and somebody else may already be running one here. A detached
worktree (`git worktree add --detach /tmp/kivo-drive HEAD`) with `node_modules`
hard-linked into it (`cp -al`) is the cheap way.

Then sign in as a seeded person and drive pages:

```bash
set -a; . scripts/local-verify/.env.local-verify; set +a
npx tsx --tsconfig scripts/local-verify/drive/tsconfig.json \
  scripts/local-verify/drive/session.ts ada@kivo.local > /tmp/ada-cookie.txt
bash scripts/local-verify/drive/pages.sh
```

The drivers:

```bash
npx tsx --tsconfig scripts/local-verify/drive/tsconfig.json scripts/local-verify/drive/fantasy.ts
npx tsx --tsconfig scripts/local-verify/drive/tsconfig.json scripts/local-verify/drive/match-centre.ts
npx tsx --tsconfig scripts/local-verify/drive/tsconfig.json scripts/local-verify/drive/rls.ts
```

`fantasy.ts` mutates the database (it finishes matches on purpose). Re-run
`rebuild.sh` before treating a later run as a clean one.

---

## What the scenario adds, and why each case is there

Everything below has either broken something or would hide a break by being
absent:

- **Two competitions with different coverage.** One where the provider declares
  per-player statistics, one where it declares it has none, and capabilities it
  never declared either way — because `null` is a third state and rendering it
  as "no" is a claim nobody made.
- **A player with statistics in both**, where one reports assists and the other
  does not. "0 assists" and "assists not reported" are different sentences.
- **A finished fixture with events, a finished fixture with none**, one at
  half-time, one in play, one not yet kicked off.
- **Lineups with a provider grid on one side and none on the other**, which is
  the difference between a heatmap anchored to a formation slot and one that
  honestly widens because it does not know the column.
- **Squads either side of a deadline, and transfers that cost points.**
- **A match room with posts, replies, reactions and a poll.**

## What it is not

Not a Supabase emulator, and not a substitute for the real thing.

- The shim implements the parts of PostgREST the application uses. Unsupported
  syntax throws by name rather than returning something plausible, because a
  quiet wrong answer here would be worse than no answer — but a *bug* in the
  shim can still make working code look broken. **Verify every finding against
  raw SQL before believing it.** Three findings during the first run of this
  harness were the harness, not the product.
- `pg_cron` and `pg_net` are local stand-ins that record and never fire. A
  verification database must not make outbound calls.
- Postgres 16 here against 17 live.
- `auth` is a stand-in: sign-in is one hard-coded OTP. Nothing about real
  Supabase Auth — rate limits, email delivery, refresh rotation — is exercised.

## Safety

`10_scenario.sql` invents users, which `supabase/seed.sql` deliberately refuses
to do. Four things keep that off any real database: it refuses to run unless
the seed has already run (so it can only land where the seed's own three guards
passed), it refuses any database holding provider mappings that are not its own
or the seed's, every row it writes is registered under the provider
`kivo-scenario`, and it does not live in `supabase/` — `supabase db reset` will
never pick it up and no deploy path runs it.
