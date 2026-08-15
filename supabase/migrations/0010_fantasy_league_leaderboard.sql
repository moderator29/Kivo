-- fantasy_teams, fantasy_points and profiles are all owner-only RLS
-- (fantasy_teams_all_own, fantasy_points_select_own, profiles_select_own_or_admin),
-- correct for "don't leak another user's squad/points to strangers" but that
-- also means a plain client-side select can never show a teammate's row in a
-- shared league leaderboard. Same fix shape as get_fantasy_team_league: a
-- SECURITY DEFINER RPC scoped by an explicit ownership check inside the
-- function body (caller must own a team in the league being queried), not a
-- widened base policy on any of the three tables.
create or replace function public.get_fantasy_league_leaderboard(p_team_id uuid)
returns table (
  team_id        uuid,
  team_name      text,
  owner_username text,
  total_points   bigint,
  has_scores     boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_team fantasy_teams%rowtype;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_team from fantasy_teams ft where ft.id = p_team_id;
  if not found or v_team.owner_profile_id <> v_profile_id then
    raise exception 'You don''t own that fantasy team.';
  end if;

  return query
    select
      ft.id as team_id,
      ft.name as team_name,
      p.username as owner_username,
      coalesce(sum(fp.points), 0)::bigint as total_points,
      bool_or(fp.id is not null) as has_scores
    from fantasy_teams ft
    join profiles p on p.id = ft.owner_profile_id
    left join fantasy_points fp on fp.fantasy_team_id = ft.id
    where ft.league_id = v_team.league_id
    group by ft.id, ft.name, p.username
    order by total_points desc, ft.name asc;
end;
$$;

revoke execute on function public.get_fantasy_league_leaderboard(uuid) from public;
revoke execute on function public.get_fantasy_league_leaderboard(uuid) from anon;
grant execute on function public.get_fantasy_league_leaderboard(uuid) to authenticated;
