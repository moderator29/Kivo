-- Real daily-activity streak for /rewards (founder request).
--
-- "Qualifying day" definition: a calendar day (UTC) on which the profile has
-- at least one xp_ledger row. xp_ledger is already the single trust-sensitive
-- ledger every genuine engagement action writes to server-side (awardXp() in
-- src/lib/rewards.ts, never client-settable) — submitting a prediction,
-- making a fantasy transfer, posting/commenting, onboarding steps, earning a
-- badge, etc. Reusing it means the streak can never be padded by a bare page
-- view (nothing writes XP for just looking at a page), and it can't quietly
-- drift from what /rewards already calls "earning XP" — one ledger, one
-- definition of "active", used everywhere.
--
-- No new write path or table: the streak is derived live from
-- xp_ledger.created_at, same "derive over duplicate" reasoning as
-- get_xp_total() in 0023_xp_total_and_sync_run_pruning.sql. The existing
-- idx_xp_ledger_profile_id (profile_id, created_at desc) index already
-- covers exactly this access pattern (an index-only scan of one profile's
-- rows), so this stays cheap as the ledger grows without adding a second
-- write path that could ever disagree with the ledger.
--
-- Day boundary is UTC — profiles has no timezone column, so this is the same
-- simple, honest choice implicitly made by every other created_at-based date
-- comparison already in this schema.
--
-- Streak semantics:
--   longest_streak: the longest run of consecutive UTC calendar days with
--     >=1 xp_ledger row, ever recorded for this profile.
--   current_streak: the run of consecutive UTC calendar days with >=1
--     xp_ledger row that is still "alive" today — its last day must be today
--     or yesterday (a user active yesterday hasn't broken their streak until
--     today ends with zero activity). 0 once the most recent active day is
--     further back than yesterday, or if the profile has no xp_ledger rows.
create or replace function public.get_activity_streak(p_profile_id uuid)
returns table (current_streak integer, longest_streak integer)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with active_days as (
    select distinct (created_at at time zone 'utc')::date as day
    from xp_ledger
    where profile_id = p_profile_id
      and p_profile_id = private.current_profile_id()
  ),
  -- Classic gaps-and-islands: subtracting a same-scaled running row number
  -- from each date gives a constant "island_key" for every run of
  -- consecutive dates, so grouping by it isolates each streak.
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
-- Explicit anon revoke too: this project's default privileges grant execute
-- to anon on new functions, so "revoke from public" alone (which was enough
-- for get_xp_total in 0023) doesn't strip anon's separate direct grant here.
revoke execute on function public.get_activity_streak(uuid) from anon;
grant execute on function public.get_activity_streak(uuid) to authenticated;

-- To reverse: drop function public.get_activity_streak(uuid).
