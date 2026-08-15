-- =============================================================================
-- Fantasy player pricing + invite-code redemption
-- =============================================================================
-- fantasy_player_prices is KIVO's own internal fantasy-game currency — the
-- same way FPL's own player "price" is an internal game-balancing number,
-- not a claim about a player's real transfer/market value. Real market value
-- is permanently out of scope: API-Football doesn't track it, Transfermarkt
-- has no API, and scraping it violates their ToS. This table makes no such
-- claim under any name.
--
-- Kept off `players` itself (a game-specific field doesn't belong on the
-- shared football-reference table) in a lean per-season table, mirroring the
-- per-season shape already used by fantasy_gameweeks.
--
-- There is no real performance history yet to derive prices from, so every
-- player gets the identical flat, clearly-arbitrary starting price (5.0) —
-- inventing per-player differentiation from nothing would just be a
-- different flavour of fabrication. Rows are backfilled lazily (mirroring
-- profiles' getOrCreateProfile fallback-creation pattern) rather than
-- bulk-inserted here, since the football-data pipeline determines which
-- players/seasons actually exist.
create table fantasy_player_prices (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players (id) on delete cascade,
  season_id   uuid not null references seasons (id) on delete cascade,
  price       numeric(4,1) not null default 5.0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fantasy_player_prices_unique_player_season unique (player_id, season_id),
  constraint fantasy_player_prices_price_range check (price between 3.5 and 15.0)
);

comment on table fantasy_player_prices is
  'Internal fantasy-game currency for classic squad-building, in FPL-style "millions" — NOT a real market valuation. Every row currently defaults to a flat, clearly-arbitrary starting price (5.0); no per-player differentiation is fabricated without real performance history to derive it from.';

comment on column fantasy_player_prices.price is
  'KIVO fantasy price (e.g. 4.5-13.0), internal game-balancing number only — never presented as, or derived from, real-world market value.';

create trigger trg_fantasy_player_prices_updated_at before update on fantasy_player_prices
  for each row execute function set_updated_at();

create index idx_fantasy_player_prices_season_id on fantasy_player_prices (season_id);

alter table fantasy_player_prices enable row level security;

-- Same shape as the other football-reference tables (players, teams, ...):
-- public read, admin/data-pipeline write. The app's lazy backfill (default
-- price for players who don't have a row yet) goes through the service-role
-- client, same rationale as xp_ledger / notifications being system-written.
create policy fantasy_player_prices_select_public on fantasy_player_prices
  for select to authenticated, anon
  using (true);

create policy fantasy_player_prices_insert_admin on fantasy_player_prices
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

create policy fantasy_player_prices_update_admin on fantasy_player_prices
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

create policy fantasy_player_prices_delete_admin on fantasy_player_prices
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


-- -----------------------------------------------------------------------------
-- redeem_invite_code: join a private fantasy league by code
-- -----------------------------------------------------------------------------
-- fantasy_leagues is owner-only per fantasy_leagues_all_own (see
-- 0001_kivo_core_schema.sql's comment on that policy) — a non-member can't
-- SELECT another creator's league row to validate an invite code client-side.
-- This SECURITY DEFINER RPC is the escape hatch that comment calls for:
-- it looks up the league (bypassing RLS, like private.current_profile_id()
-- already does elsewhere), enforces the max_teams cap, and creates the
-- caller's fantasy_teams row — all without widening fantasy_leagues' base
-- SELECT policy to every authenticated user.
create or replace function public.redeem_invite_code(p_invite_code text)
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

  select * into v_league from fantasy_leagues fl where fl.invite_code = p_invite_code;
  if not found then
    raise exception 'Invalid invite code — check and try again.';
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

grant execute on function public.redeem_invite_code(text) to authenticated;

-- To reverse: drop function public.redeem_invite_code(text), then drop table
-- fantasy_player_prices (cascades its policies/index/trigger).
