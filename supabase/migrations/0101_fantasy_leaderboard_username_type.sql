-- =============================================================================
-- The fantasy league leaderboard has never been able to return a row
-- =============================================================================
--
-- `get_fantasy_league_leaderboard` declares `owner_username text` and selects
-- `p.username`, which is `citext`. In a plpgsql function that is not a
-- coercion Postgres will perform: `return query` converts the result set to
-- the declared record type by position, and that conversion requires the types
-- to match rather than merely to be castable. Every call that reaches the
-- query raises:
--
--   42804  structure of query does not match function result type
--          Returned type extensions.citext does not match expected type text
--          in column 3
--
-- So the leaderboard on /fantasy has never rendered an entry — not for one
-- league, but for any league, since the function was added in 0010. The page
-- handles the error quietly and shows an empty leaderboard, which reads as
-- "nobody has scored yet" and is the reason this survived: the failure looks
-- exactly like the ordinary empty state.
--
-- It went unnoticed for a second reason worth writing down. The live database
-- has no fantasy teams at all, so every call so far has raised the earlier,
-- deliberate `You don't own that fantasy team` and returned before reaching
-- the query. The defect only exists once somebody has a squad. It was found by
-- running the product against a seeded database with two managers in a league.
--
-- The same mistake was already made and already fixed once, in
-- `get_prediction_league_leaderboard`, which casts `p.username::text` for
-- exactly this reason (0075). This is the sibling that was missed.
--
-- Only the cast changes. The ownership gate, the grouping, the ordering and
-- the security context are byte-for-byte what 0010 defined, so this cannot
-- alter who can see what.
-- =============================================================================

create or replace function get_fantasy_league_leaderboard(p_team_id uuid)
returns table (
  team_id uuid,
  team_name text,
  owner_username text,
  total_points bigint,
  has_scores boolean
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
      -- The cast. `profiles.username` is citext; the declared column is text,
      -- and `return query` will not bridge that on its own.
      p.username::text as owner_username,
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
