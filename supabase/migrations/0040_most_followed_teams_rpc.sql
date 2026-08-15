-- RECOMMENDATIONS.md item 128 (search: recent + trending). No view-tracking
-- of any kind exists in this codebase (confirmed by search — no page-view
-- table, no analytics event log), so a genuine "most viewed" trending list
-- would have to be fabricated. `follows` is real usage data instead: how
-- many real profiles have actually followed a team. follows_select_own
-- (migration 0001) restricts a plain client select to the caller's own
-- rows, so a raw "most-followed teams" query can't be built from the
-- client directly — same reasoning as get_prediction_consensus (0032):
-- expose only the aggregate (team_id + follower_count), never who follows
-- whom, through a narrow SECURITY DEFINER function.
create or replace function public.get_most_followed_teams(p_limit int default 8)
returns table (
  team_id uuid,
  follower_count bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select followed_id as team_id, count(*)::bigint as follower_count
  from follows
  where followed_type = 'team'
  group by followed_id
  order by follower_count desc, followed_id
  limit greatest(p_limit, 0)
$$;

revoke execute on function public.get_most_followed_teams(int) from public;
grant execute on function public.get_most_followed_teams(int) to anon, authenticated;

-- To reverse: drop function public.get_most_followed_teams(int);
