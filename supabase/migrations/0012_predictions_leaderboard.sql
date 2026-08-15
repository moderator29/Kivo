-- predictions_select_own restricts a plain select to the caller's own rows
-- (correct: nobody should read another user's individual pick before a
-- fixture locks), which also means the cross-user aggregate the
-- /predictions leaderboard needs can never be built from a plain client
-- query. Same shape as get_fantasy_league_leaderboard: a SECURITY DEFINER
-- function that returns only a narrow, already-public-facing aggregate
-- (username/display_name + summed points, never an individual pick), scored
-- rows only (points_awarded is null until a fixture is resolved). The
-- leaderboard is a public, platform-wide ranking (not scoped to a league a
-- caller must belong to), so unlike get_fantasy_league_leaderboard this
-- grants to anon as well, matching get_public_profiles.
create or replace function public.get_predictions_leaderboard(p_limit int default 20)
returns table (
  profile_id   uuid,
  username     text,
  display_name text,
  total_points bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    p.profile_id,
    pr.username,
    pr.display_name,
    p.total_points
  from (
    select profile_id, sum(points_awarded)::bigint as total_points
    from predictions
    where points_awarded is not null
    group by profile_id
  ) p
  join profiles pr on pr.id = p.profile_id
  order by p.total_points desc, pr.username asc
  limit greatest(least(p_limit, 100), 1);
$$;

revoke execute on function public.get_predictions_leaderboard(int) from public;
grant execute on function public.get_predictions_leaderboard(int) to anon, authenticated;

-- To reverse: drop function public.get_predictions_leaderboard(int).
