-- =============================================================================
-- Sync reliability and observability — KN-81, KN-82, KN-86, KN-87, KN-88, KN-95
-- =============================================================================
-- Six findings that are all the same finding from different angles: the sync
-- pipeline can tell you a *run* went wrong, and nothing else. Not which entity
-- failed, not whether two runs collided, not whether a fixture quietly stopped
-- being reported, not whether the same real-world goal got written twice, not
-- whether any of it is getting worse over time, and not why the data looks the
-- way it does when the provider contradicts itself.
--
-- Batched into one migration because they share the same three tables and the
-- same admin-only access posture, and because splitting them would mean six
-- migrations landing in a tree four other agents are also writing migrations
-- into. Every piece below is additive: one new column on `fixtures`, one on
-- `sync_runs`, three new tables, one new index, six functions. Nothing is
-- dropped, rewritten in place, or backfilled with a value the data cannot
-- support.
--
-- A note on grants that this project learned the hard way (migration 0025):
-- default privileges here auto-grant EXECUTE on new public-schema functions to
-- `anon` via an explicit grant, so `revoke ... from public` does NOT strip it.
-- Every function below therefore revokes from `public`, `anon` AND
-- `authenticated` by name, and grants back only what each one genuinely needs.


-- =============================================================================
-- KN-82. Two overlapping runs doing the same work twice
-- =============================================================================
-- The item proposes "a Postgres advisory lock keyed on (provider, entity_type)
-- held for the duration of a run". That is the right idea and the wrong
-- mechanism *for this architecture*, which is worth writing down rather than
-- silently substituting: a session-level advisory lock lives on one Postgres
-- session, and every call this app makes goes through PostgREST, which hands
-- out a pooled connection per request. `syncTodayFixtures` makes dozens of
-- round trips; there is no single session to hold anything across them. An
-- advisory lock taken in one RPC is released the moment that RPC returns.
--
-- So: a lease, which is the standard answer when a lock has to outlive a
-- connection. One row per (provider, entity_type), claimed atomically, held
-- until an explicit release or until it expires. The advisory lock still does
-- real work — inside the claim, to serialise two simultaneous claimants — it
-- just is not what represents the run.
--
-- Expiry is what makes this strictly better than the two-minute `status =
-- 'running'` heuristic in src/app/api/cron/sync-live/route.ts, which KN-4
-- showed can be poisoned by a stuck row: a crashed worker's lease expires on
-- its own, and a *live* worker can extend its own lease past the window
-- because it holds the token. The heuristic could do neither.

create table if not exists sync_locks (
  provider      text not null,
  entity_type   provider_entity_type not null,
  token         uuid not null,
  holder        text,                                  -- free-text: 'cron', 'admin:<profile id>', a hostname
  sync_run_id   uuid references sync_runs (id) on delete set null,
  acquired_at   timestamptz not null default now(),
  expires_at    timestamptz not null,
  primary key (provider, entity_type),
  constraint sync_locks_expiry_after_acquisition check (expires_at > acquired_at)
);

comment on table sync_locks is
  'Lease-based mutual exclusion for sync runs (KN-82). One row per (provider, entity_type). A lease outlives the connection that took it, which a session advisory lock cannot do across PostgREST''s pooled, per-request connections. Written only by the service-role client.';

alter table sync_locks enable row level security;

-- Readable by the same roles that can read sync_runs, so Data Health can show
-- "a run is in progress, held since X". No client-facing write policy at all:
-- claiming and releasing go through the service-role functions below, exactly
-- like xp_ledger's server-only write rule.
create policy sync_locks_select_admin on sync_locks
  for select to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

/**
 * Claims the lease, or returns null if somebody else holds an unexpired one.
 *
 * `pg_advisory_xact_lock` serialises concurrent claimants for the duration of
 * this statement only — without it, two callers can both evaluate the
 * ON CONFLICT ... WHERE predicate against the same pre-update row and both
 * believe they won. It is keyed on a hash of the same (provider, entity_type)
 * pair the row is keyed on, so unrelated entity types never wait on each other.
 */
create or replace function public.claim_sync_lock(
  p_provider text,
  p_entity_type provider_entity_type,
  p_lease_seconds integer default 600,
  p_holder text default null,
  p_sync_run_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 1 and 3600, got %', p_lease_seconds
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('kivo.sync_lock:' || p_provider || ':' || p_entity_type::text));

  insert into sync_locks (provider, entity_type, token, holder, sync_run_id, acquired_at, expires_at)
  values (
    p_provider, p_entity_type, gen_random_uuid(), p_holder, p_sync_run_id,
    now(), now() + make_interval(secs => p_lease_seconds)
  )
  on conflict (provider, entity_type) do update
    set token       = gen_random_uuid(),
        holder      = excluded.holder,
        sync_run_id = excluded.sync_run_id,
        acquired_at = now(),
        expires_at  = excluded.expires_at
    where sync_locks.expires_at <= now()   -- only a dead lease may be taken over
  returning token into v_token;

  return v_token;  -- null when the WHERE above declined the takeover
end;
$$;

/** Extends a lease the caller still holds. Returns false if the token no longer
 * matches — i.e. somebody else took over after it expired, in which case the
 * caller must stop, not carry on writing. */
create or replace function public.renew_sync_lock(
  p_provider text,
  p_entity_type provider_entity_type,
  p_token uuid,
  p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 1 and 3600, got %', p_lease_seconds
      using errcode = '22023';
  end if;

  update sync_locks
     set expires_at = now() + make_interval(secs => p_lease_seconds)
   where provider = p_provider and entity_type = p_entity_type and token = p_token;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

/** Releases a lease. Token-checked, so a run that already lost its lease to
 * expiry cannot release the lease its successor now holds. */
create or replace function public.release_sync_lock(
  p_provider text,
  p_entity_type provider_entity_type,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from sync_locks
   where provider = p_provider and entity_type = p_entity_type and token = p_token;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke execute on function public.claim_sync_lock(text, provider_entity_type, integer, text, uuid) from public, anon, authenticated;
revoke execute on function public.renew_sync_lock(text, provider_entity_type, uuid, integer) from public, anon, authenticated;
revoke execute on function public.release_sync_lock(text, provider_entity_type, uuid) from public, anon, authenticated;
grant execute on function public.claim_sync_lock(text, provider_entity_type, integer, text, uuid) to service_role;
grant execute on function public.renew_sync_lock(text, provider_entity_type, uuid, integer) to service_role;
grant execute on function public.release_sync_lock(text, provider_entity_type, uuid) to service_role;


-- =============================================================================
-- KN-81. A failed *entity*, not just a failed run
-- =============================================================================
-- `sync_runs.error_message` holds at most 20 concatenated failure strings. It
-- cannot be queried, cannot drive a retry, and silently drops failure 21. This
-- is the same information as a row per failure, which can do all three.
--
-- `resolved_at` is what turns this from a log into a work queue: a failure
-- stays open until a later run actually succeeds on that same provider entity,
-- and the sync marks it resolved in one bulk statement at the end of a run
-- rather than a write per entity.

create table if not exists sync_run_failures (
  id                  uuid primary key default gen_random_uuid(),
  sync_run_id         uuid not null references sync_runs (id) on delete cascade,
  provider            text not null,
  entity_type         provider_entity_type not null,
  provider_entity_id  text not null,
  error_message       text not null,
  error_code          text,                              -- e.g. a Postgres SQLSTATE, when there is one
  context             jsonb not null default '{}'::jsonb, -- e.g. {"label": "Arsenal v Chelsea"} for a readable list
  resolved_at         timestamptz,
  created_at          timestamptz not null default now(),
  constraint sync_run_failures_unique_entity_per_run unique (sync_run_id, entity_type, provider_entity_id),
  constraint sync_run_failures_message_length check (char_length(error_message) <= 2000)
);

comment on table sync_run_failures is
  'One row per entity that failed inside a sync run (KN-81), so a retry can target the failures instead of re-running the whole day. resolved_at is set when a later run succeeds on the same provider entity.';

create index if not exists idx_sync_run_failures_run on sync_run_failures (sync_run_id, created_at desc);
create index if not exists idx_sync_run_failures_open
  on sync_run_failures (provider, entity_type, provider_entity_id)
  where resolved_at is null;

alter table sync_run_failures enable row level security;

create policy sync_run_failures_select_admin on sync_run_failures
  for select to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- No client write policy: written only by the sync pipeline's service-role
-- client, same rule as sync_runs itself.

/** Marks every still-open failure for these provider entity ids as resolved.
 * One statement per run, called with the ids that actually succeeded this
 * time — so "resolved" always means "a later run really did process this",
 * never "we assumed it got better". */
create or replace function public.resolve_sync_run_failures(
  p_provider text,
  p_entity_type provider_entity_type,
  p_provider_entity_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated integer;
begin
  if p_provider_entity_ids is null or array_length(p_provider_entity_ids, 1) is null then
    return 0;
  end if;

  update sync_run_failures
     set resolved_at = now()
   where provider = p_provider
     and entity_type = p_entity_type
     and provider_entity_id = any(p_provider_entity_ids)
     and resolved_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.resolve_sync_run_failures(text, provider_entity_type, text[]) from public, anon, authenticated;
grant execute on function public.resolve_sync_run_failures(text, provider_entity_type, text[]) to service_role;


-- =============================================================================
-- KN-88. "Is this getting worse?"
-- =============================================================================
-- Duration was already derivable (started_at/finished_at). A failure *count*
-- was not: `records_processed` counts successes and nothing counted the rest,
-- so a run that processed 250 of 300 and a run that processed 250 of 250 were
-- indistinguishable in the table.

alter table sync_runs
  add column if not exists records_failed integer;

comment on column sync_runs.records_failed is
  'Entities this run failed on (KN-88). Null means "this run predates the column or never counted", explicitly not zero — a fabricated zero would read as a clean run.';

/** Per-day rollup of sync health, for Data Health to plot rather than tail.
 *
 * SECURITY INVOKER on purpose. A SECURITY DEFINER aggregate over sync_runs
 * would bypass the admin-only RLS policy and then need to re-implement it
 * inside the function; running as the invoker means the existing policy is the
 * one and only access rule, and a non-admin caller simply aggregates over zero
 * visible rows. The service-role client bypasses RLS as it does everywhere.
 *
 * Every column here is a count or an average of real recorded values. There is
 * deliberately no "health score": a single blended number would be a judgement
 * this data cannot support, and Data Health can compare the real columns
 * across days perfectly well without one.
 */
create or replace function public.get_sync_health_summary(p_days integer default 14)
returns table (
  day                     date,
  provider                text,
  entity_type             provider_entity_type,
  runs                    bigint,
  succeeded               bigint,
  partial                 bigint,
  failed                  bigint,
  skipped                 bigint,
  records_processed       bigint,
  records_failed          bigint,
  avg_duration_seconds    numeric,
  max_duration_seconds    numeric
)
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  select
    (started_at at time zone 'UTC')::date              as day,
    sync_runs.provider,
    sync_runs.entity_type,
    count(*)                                            as runs,
    count(*) filter (where status = 'success')          as succeeded,
    count(*) filter (where status = 'partial')          as partial,
    count(*) filter (where status = 'failed')           as failed,
    count(*) filter (where status = 'skipped')          as skipped,
    coalesce(sum(sync_runs.records_processed), 0)       as records_processed,
    coalesce(sum(sync_runs.records_failed), 0)          as records_failed,
    round(avg(extract(epoch from (finished_at - started_at))) filter (where finished_at is not null), 2) as avg_duration_seconds,
    round(max(extract(epoch from (finished_at - started_at))) filter (where finished_at is not null), 2) as max_duration_seconds
  from sync_runs
  where started_at >= now() - make_interval(days => greatest(coalesce(p_days, 14), 1))
  group by 1, 2, 3
  order by 1 desc, 2, 3;
$$;

revoke execute on function public.get_sync_health_summary(integer) from public, anon;
grant execute on function public.get_sync_health_summary(integer) to authenticated, service_role;


-- =============================================================================
-- KN-87. A unique constraint on the real-world event, not just on the mapping
-- =============================================================================
-- Dedup today is entirely `provider_mappings`. That holds exactly as long as
-- the provider's event ids are stable — and stops holding the moment a
-- provider re-issues ids after a correction, or KIVO switches provider (KN-83).
-- Then the same goal exists twice and every count downstream (goal timing,
-- discipline, fantasy scoring, the rating engine) is quietly wrong.
--
-- The item proposes (fixture_id, team_id, player_id, event_type, minute). Two
-- deliberate additions:
--
--   * `added_time` — two events genuinely can share a minute when one is in
--     added time and the other is not (45 and 45+2 are both minute 45).
--   * `related_player_id` — a double substitution in the same minute for the
--     same team has the same event_type and minute; only the pair of players
--     tells them apart.
--
-- COALESCE on both nullable player columns because NULLs are distinct in a
-- unique index by default, which would have made the constraint silently not
-- apply to exactly the rows most at risk (an event whose scorer the provider
-- never named). The honest residual risk, stated rather than hidden: two
-- *genuinely distinct* events for the same team, in the same minute and added
-- time, with no player identified on either, would now collide and the second
-- would be refused. That is a rarer and much more visible failure than the
-- silent double-count it replaces, and the insert path treats 23505 here as
-- "already recorded", not as a run-ending error.
--
-- Safe to create on this project today: fixture_events currently holds zero
-- rows, so there is nothing to conflict. On a populated database this index
-- creation would fail loudly if duplicates already existed, which is the
-- correct behaviour — it must not be forced through with DISTINCT-ON deletion.

create unique index if not exists idx_fixture_events_natural_key
  on fixture_events (
    fixture_id,
    team_id,
    event_type,
    minute,
    coalesce(added_time, -1),
    coalesce(player_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(related_player_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );


-- =============================================================================
-- KN-86. A fixture the provider stops reporting
-- =============================================================================
-- `upsert_fixture_with_mapping` only ever writes, so a postponed-then-
-- rescheduled match, or one the provider re-keys, keeps its last-known status
-- on /matches forever.
--
-- Flag, never delete — absence from one day's response is not proof of
-- anything, and this is the exact place a "clever" auto-cleanup would start
-- destroying real rows on a provider hiccup.

alter table fixtures
  add column if not exists provider_last_seen_at timestamptz;

alter table fixtures
  add column if not exists absence_flagged_at timestamptz;

comment on column fixtures.provider_last_seen_at is
  'When a sync run last saw this fixture in a provider response (KN-86). Null means "never observed since this column existed" — never treated as absence, or every pre-existing row would be flagged at once.';

comment on column fixtures.absence_flagged_at is
  'Set when a sync covering this fixture''s own kickoff window completed without the provider reporting it (KN-86). An admin review signal only: nothing deletes or rewrites the fixture, and the flag clears itself the moment the provider reports it again.';

create index if not exists idx_fixtures_absence_flagged
  on fixtures (absence_flagged_at)
  where absence_flagged_at is not null;

/**
 * Flags fixtures the provider did not report in a run that genuinely covered
 * them. Returns the number newly flagged.
 *
 * The three guards that keep this from generating noise:
 *   1. Only fixtures with a kickoff inside the window the run actually asked
 *      the provider about — a run that fetched today says nothing about
 *      next week.
 *   2. Only fixtures already seen at least once (`provider_last_seen_at is not
 *      null`). A never-observed row is not evidence of disappearance.
 *   3. Only fixtures still in a pre-final state. A finished match dropping out
 *      of a "today's fixtures" response is normal and expected.
 */
create or replace function public.flag_absent_fixtures(
  p_provider text,
  p_run_started_at timestamptz,
  p_kickoff_from timestamptz,
  p_kickoff_to timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_flagged integer;
begin
  update fixtures f
     set absence_flagged_at = now()
   where f.kickoff_at >= p_kickoff_from
     and f.kickoff_at < p_kickoff_to
     and f.status in ('scheduled', 'live', 'halftime')
     and f.provider_last_seen_at is not null
     and f.provider_last_seen_at < p_run_started_at
     and f.absence_flagged_at is null
     and exists (
       select 1 from provider_mappings pm
        where pm.entity_type = 'fixture'
          and pm.kivo_entity_id = f.id
          and pm.provider = p_provider
     );

  get diagnostics v_flagged = row_count;
  return v_flagged;
end;
$$;

revoke execute on function public.flag_absent_fixtures(text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.flag_absent_fixtures(text, timestamptz, timestamptz, timestamptz) to service_role;


-- =============================================================================
-- KN-95. Why the data looks the way it does when sources disagree
-- =============================================================================
-- `upsertFixture` already detects a score going backwards and a status
-- regressing from finished — and writes both to `console.warn`, which means
-- the anomaly exists only in a server log nobody in the product can see. The
-- brief asked for conflict detection as a real surface; this is the table that
-- makes it one.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'data_anomaly_type') then
    create type data_anomaly_type as enum (
      'score_regression',      -- a score went backwards between two syncs
      'status_regression',     -- a finished fixture became un-finished
      'duplicate_event',       -- the same real-world event arrived twice
      'absent_entity',         -- previously reported, now missing (KN-86's flag, persisted)
      'provider_disagreement'  -- reserved for the multi-provider case (KN-83)
    );
  end if;
end $$;

create table if not exists data_anomalies (
  id                  uuid primary key default gen_random_uuid(),
  sync_run_id         uuid references sync_runs (id) on delete set null,
  anomaly_type        data_anomaly_type not null,
  provider            text not null,
  entity_type         provider_entity_type not null,
  provider_entity_id  text,
  kivo_entity_id      uuid,     -- polymorphic, same convention as provider_mappings
  previous_value      jsonb,
  new_value           jsonb,
  detail              text not null,
  reviewed_at         timestamptz,
  reviewed_by         uuid references profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint data_anomalies_detail_length check (char_length(detail) <= 2000),
  constraint data_anomalies_review_consistent check (
    (reviewed_at is null and reviewed_by is null) or reviewed_at is not null
  )
);

comment on table data_anomalies is
  'Persisted record of a data conflict the pipeline detected (KN-95) — a score that went backwards, a finished fixture that un-finished, a duplicate event. Descriptive only: the provider write still lands, because a false positive must never cost real data. Nothing here is inferred; each row names the two values that disagreed.';

create index if not exists idx_data_anomalies_created on data_anomalies (created_at desc);
create index if not exists idx_data_anomalies_unreviewed on data_anomalies (created_at desc) where reviewed_at is null;
create index if not exists idx_data_anomalies_entity on data_anomalies (entity_type, kivo_entity_id);

alter table data_anomalies enable row level security;

create policy data_anomalies_select_admin on data_anomalies
  for select to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- Reviewing is a real admin action on an admin-only table, so unlike the rest
-- of this migration it gets a client-facing UPDATE policy — scoped to the same
-- roles, with the WITH CHECK preventing an admin from clearing a review or
-- attributing it to somebody else.
create policy data_anomalies_review_admin on data_anomalies
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (
    private.has_role(array['football_data_admin', 'admin', 'super_admin'])
    and reviewed_at is not null
    and reviewed_by = private.current_profile_id()
  );

/** The pipeline's single entry point for recording an anomaly. A function
 * rather than a plain insert so the sync code cannot drift into writing
 * half-populated rows, and so `detail` is always accompanied by the two real
 * values that disagreed rather than a prose summary of them. */
create or replace function public.record_data_anomaly(
  p_anomaly_type data_anomaly_type,
  p_provider text,
  p_entity_type provider_entity_type,
  p_detail text,
  p_sync_run_id uuid default null,
  p_provider_entity_id text default null,
  p_kivo_entity_id uuid default null,
  p_previous_value jsonb default null,
  p_new_value jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into data_anomalies (
    sync_run_id, anomaly_type, provider, entity_type,
    provider_entity_id, kivo_entity_id, previous_value, new_value, detail
  )
  values (
    p_sync_run_id, p_anomaly_type, p_provider, p_entity_type,
    p_provider_entity_id, p_kivo_entity_id, p_previous_value, p_new_value, left(p_detail, 2000)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.record_data_anomaly(data_anomaly_type, text, provider_entity_type, text, uuid, text, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_data_anomaly(data_anomaly_type, text, provider_entity_type, text, uuid, text, uuid, jsonb, jsonb) to service_role;

/** "3 fixtures had a score regress this week" — the actual sentence KN-95 asks
 * Data Health to be able to say. SECURITY INVOKER for the same reason as
 * get_sync_health_summary: the table's own RLS policy stays the only rule. */
create or replace function public.get_data_anomaly_summary(p_days integer default 7)
returns table (
  anomaly_type   data_anomaly_type,
  provider       text,
  entity_type    provider_entity_type,
  total          bigint,
  unreviewed     bigint,
  last_seen_at   timestamptz
)
language sql
security invoker
set search_path = public, pg_temp
stable
as $$
  select
    data_anomalies.anomaly_type,
    data_anomalies.provider,
    data_anomalies.entity_type,
    count(*)                                        as total,
    count(*) filter (where reviewed_at is null)     as unreviewed,
    max(created_at)                                 as last_seen_at
  from data_anomalies
  where created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
  group by 1, 2, 3
  order by 6 desc;
$$;

revoke execute on function public.get_data_anomaly_summary(integer) from public, anon;
grant execute on function public.get_data_anomaly_summary(integer) to authenticated, service_role;


-- To reverse (in this order):
--   drop function if exists public.get_data_anomaly_summary(integer);
--   drop function if exists public.record_data_anomaly(data_anomaly_type, text, provider_entity_type, text, uuid, text, uuid, jsonb, jsonb);
--   drop table if exists data_anomalies; drop type if exists data_anomaly_type;
--   drop function if exists public.flag_absent_fixtures(text, timestamptz, timestamptz, timestamptz);
--   alter table fixtures drop column if exists absence_flagged_at, drop column if exists provider_last_seen_at;
--   drop index if exists idx_fixture_events_natural_key;
--   drop function if exists public.get_sync_health_summary(integer);
--   alter table sync_runs drop column if exists records_failed;
--   drop function if exists public.resolve_sync_run_failures(text, provider_entity_type, text[]);
--   drop table if exists sync_run_failures;
--   drop function if exists public.release_sync_lock(text, provider_entity_type, uuid);
--   drop function if exists public.renew_sync_lock(text, provider_entity_type, uuid, integer);
--   drop function if exists public.claim_sync_lock(text, provider_entity_type, integer, text, uuid);
--   drop table if exists sync_locks;
