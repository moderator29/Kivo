-- RECOMMENDATIONS items 36 and 48.
--
-- 36: get_xp_total() replaces the client-side "fetch every xp_ledger row and
-- reduce in JS" pattern used by /home and /rewards with a single aggregate
-- round trip. SECURITY DEFINER so the sum can be computed server-side in one
-- query, but scoped to the caller's own profile_id (matching
-- xp_ledger_select_own's own-row-only reasoning) rather than trusting
-- whatever p_profile_id a caller passes in — xp_ledger is documented in
-- 0001_kivo_core_schema.sql as a trust-sensitive ledger, so this function
-- extends that same trust boundary rather than opening a new one.
create or replace function public.get_xp_total(p_profile_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(sum(amount), 0)::integer
  from xp_ledger
  where profile_id = p_profile_id
    and p_profile_id = private.current_profile_id();
$$;

revoke execute on function public.get_xp_total(uuid) from public;
grant execute on function public.get_xp_total(uuid) to authenticated;

-- 48: sync_runs retention. No cron in this codebase by design, so this is an
-- admin-triggered prune (see pruneSyncRuns() in
-- src/app/admin/data-health/actions.ts), not a scheduled job. SECURITY
-- DEFINER + revoked from authenticated: only the service-role client the
-- admin action already uses can call it, same posture as the other
-- football-data-admin RPCs in this file's neighboring migrations.
create or replace function public.prune_sync_runs(p_older_than_days integer default 90)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from sync_runs
    where started_at < (now() - (p_older_than_days || ' days')::interval)
    returning id
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function public.prune_sync_runs(integer) from public;
revoke execute on function public.prune_sync_runs(integer) from authenticated;
grant execute on function public.prune_sync_runs(integer) to service_role;

-- To reverse: drop function public.get_xp_total(uuid); drop function
-- public.prune_sync_runs(integer). See 0025 for a grants follow-up that
-- must also be considered if reverting this.
