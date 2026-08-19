-- =============================================================================
-- An activity streak must count days you EARNED something, not days the ledger
-- happened to be written to
-- =============================================================================
-- `get_activity_streak` (0037) derives "active days" from
-- `select distinct date from xp_ledger where profile_id = ...`. That was exactly
-- right while every row in the ledger was an award: a row existed if and only if
-- the user had done something that day.
--
-- It stops being right the moment the ledger can be written to for any other
-- reason, and it now can. `reconcileXp` (src/lib/rewards.ts) writes a
-- compensating row when a prediction's verdict changes — a corrected final
-- score, a detail sync landing late, a fixed scoring bug. Those rows are dated
-- when the correction happened, not when the user played, and they are usually
-- negative.
--
-- Left alone, an admin re-scoring a fixture on a Tuesday would silently mark
-- Tuesday "active" for every affected user, extending — or inventing — streaks
-- for people who did not open KIVO that day. That is a fabricated fact about a
-- user, produced by an admin action they never took, which is precisely the
-- class of thing this product does not do.
--
-- So: only rows with a positive amount count as activity. A take-back is a real
-- ledger entry and still shows on /rewards; it is simply not evidence that
-- somebody turned up.
--
-- Same name, same signature, same return shape, so `create or replace` keeps the
-- existing grants. They are re-stated below anyway, because a recreated function
-- silently losing its grants has really happened on this project.

create or replace function public.get_activity_streak(p_profile_id uuid)
returns table (current_streak integer, longest_streak integer)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with active_days as (
    -- amount > 0 is the whole change. A negative reconciliation row records
    -- that KIVO took XP back; it does not record that the user was here.
    select distinct (created_at at time zone 'utc')::date as day
    from xp_ledger
    where profile_id = p_profile_id
      and p_profile_id = private.current_profile_id()
      and amount > 0
  ),
  islands as (
    select
      day,
      day - (row_number() over (order by day))::integer as island_key
    from active_days
  ),
  runs as (
    select max(day) as end_day, count(*) as len
    from islands
    group by island_key
  )
  select
    coalesce(
      (select len::integer from runs
       where end_day >= (now() at time zone 'utc')::date - 1
       order by end_day desc
       limit 1),
      0
    ) as current_streak,
    coalesce((select max(len)::integer from runs), 0) as longest_streak;
$$;

revoke execute on function public.get_activity_streak(uuid) from public;
revoke execute on function public.get_activity_streak(uuid) from anon;
grant execute on function public.get_activity_streak(uuid) to authenticated;

-- To reverse: restore the body from 0037_activity_streak.sql (drop the
-- `and amount > 0` line), then re-run the same revoke/grant block.
