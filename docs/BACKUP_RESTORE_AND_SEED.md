# Backups, restore, and the development seed

KN-96. Before this document there were 60-odd migrations, no seed, no written
restore procedure, and no local-development data path. A new developer or a new
agent session could bring up the schema and had nothing to put in it, and
nobody had written down what happens if the live project is lost.

This is that, in three parts: what protects the live database, how to bring a
database back, and how to fill an empty one with something to look at.

---

## 1. What protects the live project today

**Supabase's own automated backups.** The project (`gkyjfihxxdynfwqhhpyn`) gets
whatever backup policy its plan includes — on the free tier that is daily
backups with a short retention window, and no point-in-time recovery. That is
the honest position: KIVO does not currently have PITR, and nothing in this
repository can change that. Enabling it is a plan-level decision only the
founder can make, in the Supabase dashboard, and it is worth making before real
users exist rather than after.

**Migrations are the schema's real backup.** Every schema change in this project
is a numbered file in `supabase/migrations/` *and* is applied to the live
project — never one without the other. That is why a total loss of the database
is a recoverable event rather than a catastrophic one: the schema can be
reconstructed exactly, from source control, by replaying the migrations in
order. What cannot be reconstructed from this repository is the *data*, which
is what the rest of this document is about.

**What is NOT backed up by anything in this repo.**

| Thing | Where it lives | Recoverable from git? |
|---|---|---|
| Schema (tables, RLS, functions, indexes) | `supabase/migrations/` | Yes — replay in order |
| Football data (teams, fixtures, events, standings) | Supabase | No, but re-syncable from the provider |
| User-owned data (profiles, posts, predictions, fantasy, XP) | Supabase | **No.** This is the irreplaceable half |
| Supabase Auth users | `auth.users` | **No** |
| Storage objects (uploaded avatars) | Supabase Storage | **No** |

The two rows in bold are the reason a manual dump before anything risky is not
paranoia. Football data can be re-synced; a user's posts and prediction history
cannot be re-created from anywhere.

---

## 2. Taking a backup by hand

Requires the Postgres connection string from the Supabase dashboard
(Project Settings → Database → Connection string → URI) and `pg_dump` from a
Postgres client whose major version is at least the server's.

```bash
# Everything: schema + data + auth + storage metadata.
pg_dump "$DATABASE_URL" --clean --if-exists --quote-all-identifiers \
  --file "kivo-$(date -u +%Y%m%dT%H%M%SZ).sql"

# Data only, when the schema is already known-good from migrations. This is
# usually the more useful one — it restores onto a freshly migrated database
# without fighting over object ownership.
pg_dump "$DATABASE_URL" --data-only --disable-triggers \
  --schema=public --schema=auth \
  --file "kivo-data-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

Two things worth knowing before you rely on the second form:

- `--schema=auth` matters. `profiles.auth_user_id` references `auth.users`, so a
  data-only dump of `public` alone restores into a database where every profile
  fails its foreign key. Dump both or neither.
- `--disable-triggers` is what stops the restore re-firing application triggers
  (`set_updated_at`, the poll-vote counter, the follows cleanup) and rewriting
  the very values being restored. It requires superuser or table ownership,
  which the Supabase connection string has.

**Storage objects are separate.** `pg_dump` captures the *metadata* rows for
Storage, not the files. Uploaded avatars have to be copied out of the `avatars`
bucket independently (Supabase CLI or the Storage API). A restore that skips
this produces profiles whose `avatar_uploaded_url` points at nothing —
recoverable, since `resolveAvatarSrc` falls back to the assigned KIVO avatar,
but the user's own picture is gone.

---

## 3. Restoring

### 3.1 Into a brand-new Supabase project

1. Create the project. Note its ref, URL and keys.
2. Replay the schema, in filename order:
   ```bash
   for f in supabase/migrations/*.sql; do
     psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
   done
   ```
   Order is by filename, and the numeric prefixes are what make that correct.
   `ON_ERROR_STOP=1` is not optional: a half-applied migration set that
   continued past a failure is worse than one that stopped.
3. Restore the data dump:
   ```bash
   psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f kivo-data-<timestamp>.sql
   ```
4. Re-point the app: `NEXT_PUBLIC_SUPABASE_URL`, the publishable key, and
   `SUPABASE_SERVICE_ROLE_KEY` in Vercel — **and redeploy**. `NEXT_PUBLIC_*`
   values are baked in at build time, so saving them without a fresh deployment
   changes nothing. This has bitten this project before; see `ENVIRONMENT.md`.
5. Re-check the security advisors (`get_advisors`) before letting anyone in. A
   restore is exactly when an RLS policy quietly fails to come across.

### 3.2 Point-in-time / dashboard restore

If the plan has it, the Supabase dashboard's own restore is strictly better than
the above — it restores auth and storage with the database, in one operation,
and does not depend on anybody having remembered to run `pg_dump`. Use it in
preference to a manual restore whenever it is available.

### 3.3 After any restore

- Football data may be stale by however long the gap was. It re-syncs on the
  next admin "Sync now" or scheduled run; nothing needs repairing by hand.
- `sync_locks` may hold a lease from a run that was in flight when the snapshot
  was taken. It expires on its own (10 minutes), or delete the row.
- Check that `seasons.is_current` still has exactly one row per competition —
  `idx_seasons_one_current_per_competition` enforces it, so a restore that
  succeeded has it right, but it is the first thing to look at if `/fantasy` or
  a team's league position renders empty.

---

## 4. The development seed

`supabase/seed.sql`. Read its header before running it — the short version:

**Everything it inserts is synthetic and is labelled as such.** The competition
is the "KIVO Sandbox League", every club in it is invented, and every seeded row
is registered in `provider_mappings` under the provider `kivo-seed` so seeded
data is distinguishable from synced data everywhere, and removable in one step.
This is the one place in KIVO where fabricated football data is legitimate,
precisely because it is quarantined, labelled and impossible to mistake for a
sync.

```bash
# Local Supabase CLI — this file is the CLI's conventional seed location, so a
# reset applies every migration and then seeds automatically.
supabase db reset

# Any other database, explicitly:
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "set kivo.seed_confirmed = 'yes'" -f supabase/seed.sql
```

Three guards stop it running somewhere it should not: it requires the
`kivo.seed_confirmed` setting to be set explicitly, it refuses a database with
any profile linked to a real Supabase Auth user, and it refuses a database
holding provider mappings from a real sync. (The second guard is not
theoretical — it correctly refused the live project on 2026-08-18, the day a
real user first signed in.)

### What you get

| | |
|---|---|
| 1 competition, 1 current season | "KIVO Sandbox League", 2026/2027 |
| 10 clubs, 10 venues, 10 managers | Across NG/GH/SN/KE/MA/EG |
| 150 players | 15 per club: 2 GK / 5 DEF / 5 MID / 3 FWD — exactly `SQUAD_RULES` |
| 25 fixtures over 5 matchdays | 3 matchdays finished, 1 in progress (a live and a halftime match), 1 scheduled |
| 56 goal events | Generated to match each fixture's own scoreline exactly |
| 300 lineup rows | 11 starters + 4 bench per side, formation `4-3-3` |
| 36 statistics rows | Possession totals exactly 100 per fixture |
| 10 standings rows | **Computed from the fixtures**, never hand-written |
| 5 fantasy gameweeks | Deadline at each matchday's first kickoff |

The standings line is the one worth internalising. They are derived from the
seeded results rather than typed out, so they cannot disagree with them. A seed
with a hand-written standings table is a seed that will eventually lie, and then
somebody will spend an afternoon debugging a standings bug that does not exist.

Ids are deterministic (`md5('kivo-seed:<kind>:<key>')`), so re-seeding produces
the same ids and a bookmarked `/teams/<id>` survives a reset.

### What it deliberately does not seed, and why

- **No profiles, posts, comments, polls, predictions, fantasy teams or XP.**
  All of it is user-owned under RLS, and seeding it would mean inventing users —
  which would make the social feed, the leaderboards and every "what the room
  thought" aggregate render fabricated engagement. Sign in and create them. That
  path works, and exercising it is more useful than faking its output.
- **No transfers.** `transfers.confidence` means something only if it reflects a
  real source. There is no honest synthetic value for it.
- **No `sync_runs`, `sync_run_failures` or `data_anomalies`.** Those describe
  things that happened to a database. Inventing them would make Data Health
  report history that never occurred.

### Removing it

The teardown block at the top of `seed.sql` is self-contained and deletes
strictly by `kivo-seed` provider mapping, so it can never touch a row the seed
did not create. Running the whole file again also runs the teardown first, which
is what makes it idempotent.

---

## 5. Things this document is honest about not covering

- **No automated off-site backup.** Nothing in this repo runs `pg_dump` on a
  schedule to storage KIVO controls. That is a real gap and a real decision (it
  needs somewhere to put the dumps, and credentials to put them there), not an
  oversight this document quietly resolves.
- **No tested restore.** The procedure above is written from the schema and the
  tooling, not from having restored this project. A restore procedure nobody has
  executed is a hypothesis. The cheapest way to turn it into a fact is to run
  section 3.1 once against a throwaway project.
