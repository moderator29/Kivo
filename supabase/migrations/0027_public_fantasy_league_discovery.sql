-- RECOMMENDATIONS.md item 43: fantasy_leagues.is_private exists and the
-- create-league UI offers a Private/Public toggle, but there was no
-- browse-public-leagues surface and redeem_invite_code required a code
-- regardless of is_private. This ships real discovery: two SECURITY
-- DEFINER RPCs following the exact shape of redeem_invite_code /
-- get_fantasy_team_league (fantasy_leagues and fantasy_teams are both
-- owner-only RLS -- see fantasy_leagues_all_own / fantasy_teams_all_own in
-- 0001_kivo_core_schema.sql -- so a plain client select can never list
-- someone else's public league or count its teams).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- list_public_fantasy_leagues: the browse surface's data source.
-- -----------------------------------------------------------------------------
-- Only surfaces is_private = false rows tied to a season that's still
-- current -- a public league on a finished season has no open gameweek to
-- join into, so listing it would just be a dead end for a new player.
--
-- p_search_pattern is expected pre-escaped by the caller (src/lib/text.ts's
-- escapeLikePattern, the same helper searchFantasyPlayers now uses per
-- RECOMMENDATIONS item 39) and pre-wrapped with '%...%' -- this function
-- does no escaping of its own so there is exactly one place in the codebase
-- that does, rather than two implementations that could drift.
create or replace function public.list_public_fantasy_leagues(
  p_search_pattern text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id                      uuid,
  name                    text,
  season_id               uuid,
  season_name             text,
  competition_name        text,
  competition_short_name  text,
  max_teams               smallint,
  team_count              bigint,
  created_at              timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'You must be signed in.';
  end if;

  return query
    select
      fl.id, fl.name, fl.season_id, s.name as season_name,
      c.name as competition_name, c.short_name as competition_short_name,
      fl.max_teams,
      (select count(*) from fantasy_teams ft where ft.league_id = fl.id) as team_count,
      fl.created_at
    from fantasy_leagues fl
    join seasons s on s.id = fl.season_id
    join competitions c on c.id = s.competition_id
    where fl.is_private = false
      and s.is_current = true
      and (p_search_pattern is null or fl.name ilike p_search_pattern)
    order by fl.created_at desc
    limit greatest(least(coalesce(p_limit, 20), 50), 1)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

comment on function public.list_public_fantasy_leagues(text, integer, integer) is
  'Browse surface for public fantasy leagues (RECOMMENDATIONS item 43). Only rows with is_private = false on a season that is still current. p_search_pattern must already be %-wrapped and escaped by the caller (see src/lib/text.ts escapeLikePattern) -- this function does not escape it itself.';

revoke execute on function public.list_public_fantasy_leagues(text, integer, integer) from public;
revoke execute on function public.list_public_fantasy_leagues(text, integer, integer) from anon;
grant execute on function public.list_public_fantasy_leagues(text, integer, integer) to authenticated;


-- -----------------------------------------------------------------------------
-- join_public_fantasy_league: the invite-code-free join path public leagues
-- need, so the Public toggle set at creation actually changes behavior.
-- -----------------------------------------------------------------------------
-- Mirrors redeem_invite_code's capacity check and on-conflict-do-nothing
-- insert, but is keyed by league id instead of an invite code, and -- this
-- is the important part -- re-checks is_private = false itself. Never trust
-- that a league id passed in only ever came from list_public_fantasy_leagues
-- above; this is the actual enforcement boundary that keeps a private
-- league joinable only via its code, even if its id leaked some other way.
--
-- No brute-forceable secret is involved here (unlike redeem_invite_code's
-- 6-character code -- RECOMMENDATIONS item 42), so this doesn't need that
-- function's own rate_limit_events throttle: a uuid league id isn't
-- guessable, and the app-layer checkRateLimit() call in
-- joinPublicFantasyLeague (src/app/(app)/fantasy/actions.ts) already covers
-- abuse of this RPC's write path.
create or replace function public.join_public_fantasy_league(p_league_id uuid)
returns table (id uuid, name text, season_id uuid, max_teams smallint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league fantasy_leagues%rowtype;
  v_profile_id uuid;
  v_team_count integer;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'You must be signed in to join a league.';
  end if;

  select * into v_league from fantasy_leagues fl where fl.id = p_league_id;
  if not found then
    raise exception 'That league no longer exists.';
  end if;

  if v_league.is_private then
    raise exception 'This league is private. Ask the owner for an invite code.';
  end if;

  select count(*) into v_team_count from fantasy_teams ft where ft.league_id = v_league.id;
  if v_team_count >= v_league.max_teams and not exists (
    select 1 from fantasy_teams ft where ft.league_id = v_league.id and ft.owner_profile_id = v_profile_id
  ) then
    raise exception 'This league is full.';
  end if;

  insert into fantasy_teams (owner_profile_id, league_id, name)
  values (v_profile_id, v_league.id, 'My Team')
  on conflict (league_id, owner_profile_id) do nothing;

  return query select v_league.id, v_league.name, v_league.season_id, v_league.max_teams;
end;
$$;

comment on function public.join_public_fantasy_league(uuid) is
  'Joins a public fantasy league by id, no invite code required (RECOMMENDATIONS item 43). Re-checks is_private = false itself regardless of how the caller learned the league id -- a private league can still only be joined via redeem_invite_code.';

revoke execute on function public.join_public_fantasy_league(uuid) from public;
revoke execute on function public.join_public_fantasy_league(uuid) from anon;
grant execute on function public.join_public_fantasy_league(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- Supporting indexes for the browse query above.
-- -----------------------------------------------------------------------------
create index idx_fantasy_leagues_public_created_at on fantasy_leagues (created_at desc) where is_private = false;
create index idx_fantasy_leagues_name_trgm on fantasy_leagues using gin (name gin_trgm_ops);
