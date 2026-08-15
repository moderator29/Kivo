-- fantasy_leagues is owner-only (fantasy_leagues_all_own: creator_profile_id
-- = current_profile_id()) — correct for "don't leak league config to
-- strangers", but it also means a user who *joined* a league via
-- redeem_invite_code (rather than created it) cannot read that league row at
-- all, even through an embedded join from their own fantasy_teams row. That
-- leaves a joined member with no way to discover their own league's
-- season_id (needed to find the current gameweek) or invite code (to invite
-- more friends). Same fix shape as redeem_invite_code: a SECURITY DEFINER
-- RPC scoped by an explicit ownership check inside the function body, not a
-- widened base policy.
create or replace function public.get_fantasy_team_league(p_team_id uuid)
returns table (
  league_id    uuid,
  league_name  text,
  season_id    uuid,
  is_private   boolean,
  invite_code  text,
  max_teams    smallint,
  team_count   bigint
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
    select fl.id, fl.name, fl.season_id, fl.is_private, fl.invite_code, fl.max_teams,
           (select count(*) from fantasy_teams ft2 where ft2.league_id = fl.id)
    from fantasy_leagues fl
    where fl.id = v_team.league_id;
end;
$$;

revoke execute on function public.get_fantasy_team_league(uuid) from public;
revoke execute on function public.get_fantasy_team_league(uuid) from anon;
grant execute on function public.get_fantasy_team_league(uuid) to authenticated;

-- To reverse: drop function public.get_fantasy_team_league(uuid).
