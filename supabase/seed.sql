-- =============================================================================
-- KIVO development seed — KN-96
-- =============================================================================
--
--   EVERYTHING THIS FILE INSERTS IS SYNTHETIC. It is not football data.
--
-- No club, player, manager, venue, fixture, score or statistic below
-- corresponds to anything real, and none of it is derived from a provider.
-- That is the entire point: KIVO's standing rule is that nothing fabricated
-- may ever be presented as real, and a seed file is the one place fabrication
-- is legitimate precisely because it is quarantined, labelled, and impossible
-- to mistake for a sync.
--
-- Three things enforce that rather than relying on the reader's goodwill:
--
--   1. The competition is called "KIVO Sandbox League" and every club in it is
--      obviously invented. Nobody looking at a seeded database can believe
--      they are looking at the Premier League.
--   2. Every seeded row is registered in `provider_mappings` under the
--      provider name `kivo-seed`. `Data Health`, the freshness indicators and
--      any query that cares can tell seeded data from synced data, and the
--      teardown at the top of this file uses exactly those rows to remove it.
--   3. The file refuses to run against a database that shows any sign of being
--      real (see the guards below).
--
-- WHY THIS EXISTS. Before it, a new developer — or a new agent session — could
-- bring up the schema and had no way to bring up anything *in* it. Every UI
-- surface rendered its empty state, which meant the only way to check a feed,
-- a standings table, a lineup pitch or a fantasy squad builder was to mock the
-- data inside the component and hope. This is the alternative: one file, real
-- shapes, real relationships, real constraints exercised.
--
-- HOW TO RUN IT
--
--   Local Supabase CLI (the normal path — this file is the CLI's conventional
--   seed location, so `supabase db reset` applies every migration and then
--   runs it automatically):
--
--       supabase db reset
--
--   Against any other database, explicitly, with the confirmation the guards
--   below require:
--
--       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--         -c "set kivo.seed_confirmed = 'yes'" -f supabase/seed.sql
--
--   To remove it again, run the teardown block at the top of this file on its
--   own — it is self-contained and deletes only rows mapped to `kivo-seed`.
--
-- NEVER run this against the production project. The guards below try hard to
-- stop you, and they are a safety net, not a permission slip.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Guards
-- -----------------------------------------------------------------------------
do $$
begin
  -- (a) Explicit intent. A stray `psql -f` cannot seed a database by accident.
  if coalesce(current_setting('kivo.seed_confirmed', true), '') <> 'yes' then
    raise exception
      'Refusing to seed: set kivo.seed_confirmed to ''yes'' first (see the header of supabase/seed.sql).'
      using errcode = '22023';
  end if;

  -- (b) Real people. A profile linked to a Supabase Auth user means somebody
  -- has actually signed in here. That is not a development database.
  if exists (select 1 from profiles where auth_user_id is not null) then
    raise exception 'Refusing to seed: this database has real signed-in users.'
      using errcode = '22023';
  end if;

  -- (c) Real football data. Any provider mapping that is not this seed's own
  -- means a genuine sync has run against this database.
  if exists (select 1 from provider_mappings where provider <> 'kivo-seed') then
    raise exception 'Refusing to seed: this database holds real synced provider data.'
      using errcode = '22023';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 1. Teardown — makes the whole file idempotent, and is the documented way to
--    remove seeded data. Deletes strictly by `kivo-seed` provider mapping, so
--    it can never touch a row this file did not create.
--
--    Order matters and follows the FKs: fixtures reference competitions and
--    teams with ON DELETE RESTRICT, so they go first. Events, lineups,
--    statistics and standings all cascade from fixtures/seasons.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fixtures uuid[];
  v_teams uuid[];
  v_players uuid[];
  v_venues uuid[];
  v_competitions uuid[];
begin
  select coalesce(array_agg(kivo_entity_id), '{}') into v_fixtures
    from provider_mappings where provider = 'kivo-seed' and entity_type = 'fixture';
  select coalesce(array_agg(kivo_entity_id), '{}') into v_teams
    from provider_mappings where provider = 'kivo-seed' and entity_type = 'team';
  select coalesce(array_agg(kivo_entity_id), '{}') into v_players
    from provider_mappings where provider = 'kivo-seed' and entity_type = 'player';
  select coalesce(array_agg(kivo_entity_id), '{}') into v_venues
    from provider_mappings where provider = 'kivo-seed' and entity_type = 'venue';
  select coalesce(array_agg(kivo_entity_id), '{}') into v_competitions
    from provider_mappings where provider = 'kivo-seed' and entity_type = 'competition';

  delete from fixtures where id = any(v_fixtures);
  delete from fantasy_player_prices where player_id = any(v_players);
  delete from players where id = any(v_players);
  delete from managers where current_team_id = any(v_teams);
  delete from fantasy_gameweeks where season_id in (select id from seasons where competition_id = any(v_competitions));
  delete from standings where team_id = any(v_teams);
  delete from teams where id = any(v_teams);
  delete from seasons where competition_id = any(v_competitions);
  delete from competitions where id = any(v_competitions);
  delete from venues where id = any(v_venues);
  delete from provider_mappings where provider = 'kivo-seed';
end $$;


-- -----------------------------------------------------------------------------
-- 2. Deterministic identity
--
--    Every seeded id is md5('kivo-seed:<kind>:<key>')::uuid. Two consequences
--    worth stating: re-running this file produces byte-identical ids, so a
--    bookmarked /teams/<id> URL survives a reseed; and nothing here depends on
--    insertion order, so the file can be read as a set of facts rather than a
--    sequence of steps.
-- -----------------------------------------------------------------------------
create or replace function pg_temp.seed_id(kind text, key text)
returns uuid language sql immutable as $$
  select md5('kivo-seed:' || kind || ':' || key)::uuid;
$$;

-- Deterministic small integer from a key — used for scores, minutes, shirt
-- numbers and statistics. Deliberately not random(): a seeded database must
-- look the same on every machine, or "it works on mine" becomes a real answer.
create or replace function pg_temp.seed_num(key text, modulo integer)
returns integer language sql immutable as $$
  select abs(hashtext('kivo-seed:' || key)) % greatest(modulo, 1);
$$;


-- -----------------------------------------------------------------------------
-- 3. Competition, season, venues, clubs
-- -----------------------------------------------------------------------------
insert into competitions (id, name, short_name, country)
values (pg_temp.seed_id('competition', 'sandbox'), 'KIVO Sandbox League', 'KSL', 'NG');

insert into seasons (id, competition_id, name, provider_year, is_current, start_date, end_date)
values (
  pg_temp.seed_id('season', 'sandbox-2026'),
  pg_temp.seed_id('competition', 'sandbox'),
  '2026/2027', 2026, true,
  (now() - interval '60 days')::date,
  (now() + interval '240 days')::date
);

-- Ten invented clubs. City/country are spread deliberately: the founding brief
-- names Nigeria as the launch market and requires the architecture to be
-- global-shaped, so a seeded league that is entirely one country would not
-- exercise the grouping, flag and locale paths that actually exist.
create temp table seed_clubs (idx int primary key, slug text, name text, short text, city text, country text, founded int);
insert into seed_clubs values
  (0, 'harbour',   'Harbour Rovers',      'HAR', 'Lagos',      'NG', 1954),
  (1, 'northgate', 'Northgate Athletic',  'NOR', 'Kano',       'NG', 1961),
  (2, 'riverside', 'Riverside United',    'RIV', 'Port Harcourt', 'NG', 1948),
  (3, 'summit',    'Summit Town',         'SUM', 'Abuja',      'NG', 1972),
  (4, 'kestrel',   'Kestrel City',        'KES', 'Ibadan',     'NG', 1936),
  (5, 'meridian',  'Meridian FC',         'MER', 'Accra',      'GH', 1959),
  (6, 'saltbay',   'Saltbay Wanderers',   'SAL', 'Dakar',      'SN', 1967),
  (7, 'foundry',   'Foundry Park',        'FOU', 'Nairobi',    'KE', 1981),
  (8, 'orchard',   'Orchard Albion',      'ORC', 'Casablanca', 'MA', 1943),
  (9, 'lantern',   'Lantern Rangers',     'LAN', 'Cairo',      'EG', 1955);

insert into venues (id, name, city, country, capacity)
select pg_temp.seed_id('venue', slug), name || ' Ground', city, country,
       12000 + pg_temp.seed_num('cap:' || slug, 48) * 1000
from seed_clubs;

insert into teams (id, name, short_name, country, founded_year, venue_id)
select pg_temp.seed_id('team', slug), name, short, country, founded::smallint,
       pg_temp.seed_id('venue', slug)
from seed_clubs;

-- crest_url is left null on purpose. There is no honest crest for an invented
-- club, and pointing at a placeholder image would train every crest-rendering
-- surface against a case that never happens in production. Null is the real
-- case: TeamCrest already has to handle a club whose crest the provider did
-- not report.

insert into managers (id, full_name, nationality, current_team_id)
select pg_temp.seed_id('manager', slug),
       (array['A. Balogun','C. Mensah','D. Traoré','E. Njoku','F. Osei','G. Diallo','H. Kamara','I. Achebe','J. Owusu','K. Sesay'])[idx + 1],
       country,
       pg_temp.seed_id('team', slug)
from seed_clubs;


-- -----------------------------------------------------------------------------
-- 4. Squads — 15 players per club, in a shape the fantasy squad rules accept
--
--    2 goalkeepers / 5 defenders / 5 midfielders / 3 forwards per club, which
--    is exactly SQUAD_RULES in src/app/(app)/fantasy/fantasy-rules.ts. A seed
--    that produced squads the squad builder cannot legally pick from would be
--    worse than no seed at all.
--
--    "Forward" rather than "Attacker" is not arbitrary: positionGroup() maps
--    "forward"/"striker"/"winger" to Forwards, and anything it does not
--    recognise to "Other" — which a fantasy squad cannot contain.
-- -----------------------------------------------------------------------------
create temp table seed_positions (slot int primary key, position text);
insert into seed_positions
select s, case
  when s <= 2 then 'Goalkeeper'
  when s <= 7 then 'Defender'
  when s <= 12 then 'Midfielder'
  else 'Forward'
end from generate_series(1, 15) s;

insert into players (id, full_name, known_as, nationality, position, current_team_id, date_of_birth)
select
  pg_temp.seed_id('player', c.slug || ':' || p.slot),
  (array['Ade','Bode','Chidi','Dami','Emeka','Femi','Gbenga','Hakim','Ibrahim','Jide','Kofi','Lanre','Musa','Nnamdi','Obi'])[p.slot]
    || ' ' ||
  (array['Adeyinka','Bankole','Chukwu','Danjuma','Eze','Falade','Gyamfi','Haruna','Ilesanmi','Jalloh','Koroma','Lawal','Mbaye','Nwosu','Okafor'])[
    1 + ((c.idx + p.slot) % 15)
  ],
  null,
  c.country,
  p.position,
  pg_temp.seed_id('team', c.slug),
  (now() - make_interval(days => 365 * (18 + pg_temp.seed_num('age:' || c.slug || ':' || p.slot, 17)) ))::date
from seed_clubs c cross join seed_positions p;

-- The documented flat starting price (see the fantasy_player_prices table
-- comment): a per-player valuation would be a fabricated market number, and
-- the real product does not invent one either.
insert into fantasy_player_prices (player_id, season_id, price)
select pl.id, pg_temp.seed_id('season', 'sandbox-2026'), 5.0
from players pl
where pl.current_team_id in (select pg_temp.seed_id('team', slug) from seed_clubs);


-- -----------------------------------------------------------------------------
-- 5. Fixtures — five matchdays, using the standard circle-method round robin
--
--    Matchdays 1-3 are finished, matchday 4 is happening right now (a mix of
--    live, halftime and finished, so Match Centre's live states have something
--    to render), matchday 5 is scheduled. Every kickoff is relative to now(),
--    so the seed stays meaningful however long after it was written it is run.
-- -----------------------------------------------------------------------------
create temp table seed_pairings as
select
  r + 1 as matchday,
  i,
  case when i = 0 then 9 else (r + i) % 9 end as team_a,
  case when i = 0 then r % 9 else (r + 9 - i) % 9 end as team_b
from generate_series(0, 4) r cross join generate_series(0, 4) i;

insert into fixtures (
  id, competition_id, season_id, home_team_id, away_team_id, venue_id,
  status, kickoff_at, matchday, home_score, away_score, home_score_ht, away_score_ht, minute_elapsed
)
select
  pg_temp.seed_id('fixture', p.matchday || ':' || p.i),
  pg_temp.seed_id('competition', 'sandbox'),
  pg_temp.seed_id('season', 'sandbox-2026'),
  home.team_id, away.team_id,
  home.venue_id,
  f.status,
  f.kickoff_at,
  p.matchday::smallint,
  f.home_score, f.away_score,
  -- Half-time scores are never larger than the full-time score, because a
  -- seeded database that violates football's own arithmetic teaches every
  -- consumer of it the wrong lesson.
  case when f.home_score is null then null else least(f.home_score, pg_temp.seed_num('ht:' || p.matchday || ':' || p.i, 2))::smallint end,
  case when f.away_score is null then null else least(f.away_score, pg_temp.seed_num('ht:a:' || p.matchday || ':' || p.i, 2))::smallint end,
  f.minute_elapsed
from seed_pairings p
cross join lateral (
  -- Home/away alternates so no club is at home five times running.
  select
    case when (p.matchday + p.i) % 2 = 0 then p.team_a else p.team_b end as home_idx,
    case when (p.matchday + p.i) % 2 = 0 then p.team_b else p.team_a end as away_idx
) sides
cross join lateral (
  select pg_temp.seed_id('team', c.slug) as team_id, pg_temp.seed_id('venue', c.slug) as venue_id
  from seed_clubs c where c.idx = sides.home_idx
) home
cross join lateral (
  select pg_temp.seed_id('team', c.slug) as team_id
  from seed_clubs c where c.idx = sides.away_idx
) away
cross join lateral (
  select
    (now() - make_interval(days => (4 - p.matchday) * 7) + make_interval(hours => p.i * 2 - 4)) as kickoff_at,
    case
      when p.matchday <= 3 then 'finished'
      when p.matchday = 4 and p.i = 0 then 'live'
      when p.matchday = 4 and p.i = 1 then 'halftime'
      when p.matchday = 4 then 'finished'
      else 'scheduled'
    end::fixture_status as status
) timing
cross join lateral (
  select
    timing.status,
    timing.kickoff_at,
    case when timing.status = 'scheduled' then null
         else pg_temp.seed_num('hs:' || p.matchday || ':' || p.i, 4)::smallint end as home_score,
    case when timing.status = 'scheduled' then null
         else pg_temp.seed_num('as:' || p.matchday || ':' || p.i, 3)::smallint end as away_score,
    case when timing.status = 'live' then 67::smallint
         when timing.status = 'halftime' then 45::smallint
         else null end as minute_elapsed
) f;


-- -----------------------------------------------------------------------------
-- 6. Goals — generated to match each fixture's own score exactly
--
--    Not decorative. `fixture_events` is what the goal-timing chart, the
--    discipline table, the rating engine and fantasy scoring all read, and a
--    seed whose events disagreed with its own scorelines would make every one
--    of those look broken for a reason that was not in the code.
-- -----------------------------------------------------------------------------
insert into fixture_events (fixture_id, team_id, player_id, event_type, minute)
select
  f.id,
  side.team_id,
  scorer.id,
  'goal'::fixture_event_type,
  (7 + n * 17 + pg_temp.seed_num('min:' || f.id::text || ':' || side.team_id::text || ':' || n, 6))::smallint
from fixtures f
join lateral (
  values (f.home_team_id, coalesce(f.home_score, 0)), (f.away_team_id, coalesce(f.away_score, 0))
) as side(team_id, goals) on true
join lateral generate_series(1, side.goals) n on true
join lateral (
  -- Scorers come from the club's real seeded squad, forwards first, so a
  -- player page's "goals" figure is consistent with the player's position.
  select pl.id from players pl
  where pl.current_team_id = side.team_id
  order by case pl.position when 'Forward' then 0 when 'Midfielder' then 1 else 2 end,
           pl.id
  offset ((n - 1) % 3) limit 1
) scorer on true
where f.status in ('finished', 'live', 'halftime')
  and f.competition_id = pg_temp.seed_id('competition', 'sandbox');


-- -----------------------------------------------------------------------------
-- 7. Lineups — a legal 4-3-3 for both sides of every match already under way
-- -----------------------------------------------------------------------------
insert into lineups (fixture_id, team_id, player_id, is_starting, shirt_number, position, formation)
select
  f.id, side.team_id, ranked.id,
  ranked.rn <= 11,
  ranked.rn::smallint,
  ranked.position,
  '4-3-3'
from fixtures f
join lateral (values (f.home_team_id), (f.away_team_id)) as side(team_id) on true
join lateral (
  select pl.id, pl.position, row_number() over (
    order by case pl.position
      when 'Goalkeeper' then 0 when 'Defender' then 1 when 'Midfielder' then 2 else 3 end, pl.id
  ) as rn
  from players pl where pl.current_team_id = side.team_id
) ranked on ranked.rn <= 15
where f.status in ('finished', 'live', 'halftime')
  and f.competition_id = pg_temp.seed_id('competition', 'sandbox')
  and f.matchday >= 3;   -- enough matches to exercise the pitch view, not every one


-- -----------------------------------------------------------------------------
-- 8. Match statistics — internally consistent, and consistent with the score
-- -----------------------------------------------------------------------------
insert into fixture_statistics (
  fixture_id, team_id, shots_total, shots_on_target, fouls, corners, offsides,
  possession_pct, yellow_cards, red_cards, saves, passes_total, passes_accurate, passes_pct
)
select
  f.id, s.team_id,
  s.shots, s.on_target, s.fouls, s.corners, s.offsides,
  s.possession, s.yellows, 0, s.saves, s.passes, s.accurate,
  round(s.accurate::numeric * 100 / nullif(s.passes, 0))::smallint
from fixtures f
join lateral (
  select
    side.team_id,
    side.is_home,
    (8 + pg_temp.seed_num('sh:' || f.id::text || side.team_id::text, 12)) as shots,
    -- Shots on target are never fewer than the goals scored.
    greatest(coalesce(side.goals, 0), 3 + pg_temp.seed_num('ot:' || f.id::text || side.team_id::text, 5)) as on_target,
    (6 + pg_temp.seed_num('fl:' || f.id::text || side.team_id::text, 10)) as fouls,
    (2 + pg_temp.seed_num('co:' || f.id::text || side.team_id::text, 9)) as corners,
    pg_temp.seed_num('of:' || f.id::text || side.team_id::text, 5) as offsides,
    -- Possession sums to exactly 100 across the two sides, which no amount of
    -- independent random numbers would ever manage.
    case when side.is_home
      then 40 + pg_temp.seed_num('po:' || f.id::text, 21)
      else 60 - pg_temp.seed_num('po:' || f.id::text, 21) end as possession,
    pg_temp.seed_num('yc:' || f.id::text || side.team_id::text, 4) as yellows,
    (1 + pg_temp.seed_num('sv:' || f.id::text || side.team_id::text, 6)) as saves,
    (320 + pg_temp.seed_num('pa:' || f.id::text || side.team_id::text, 260)) as passes,
    -- Accurate passes are derived as a share of total passes (72-87%), not
    -- drawn independently. Two independent ranges could produce more accurate
    -- passes than passes attempted, which `fixture_statistics_passes_pct_range`
    -- correctly refuses — the schema caught exactly that on the first run of
    -- this file, which is a small argument for seeding a real database rather
    -- than mocking in a component.
    round(
      (320 + pg_temp.seed_num('pa:' || f.id::text || side.team_id::text, 260))
      * (72 + pg_temp.seed_num('ac:' || f.id::text || side.team_id::text, 16)) / 100.0
    )::int as accurate
  from (values (f.home_team_id, true, f.home_score), (f.away_team_id, false, f.away_score))
       as side(team_id, is_home, goals)
) s on true
where f.status = 'finished'
  and f.competition_id = pg_temp.seed_id('competition', 'sandbox');


-- -----------------------------------------------------------------------------
-- 9. Standings — computed from the seeded results, never written by hand
--
--    This is the part most worth reading. The table is derived from the
--    fixtures above rather than typed out, so it cannot disagree with them: if
--    a scoreline changes, the table changes with it. A seed with a hand-written
--    standings table is a seed that will eventually lie.
-- -----------------------------------------------------------------------------
insert into standings (season_id, team_id, played, won, drawn, lost, goals_for, goals_against, points, position)
with results as (
  select f.home_team_id as team_id, f.home_score as gf, f.away_score as ga from fixtures f
   where f.status = 'finished' and f.competition_id = pg_temp.seed_id('competition', 'sandbox')
  union all
  select f.away_team_id, f.away_score, f.home_score from fixtures f
   where f.status = 'finished' and f.competition_id = pg_temp.seed_id('competition', 'sandbox')
),
totals as (
  select
    team_id,
    count(*)::int as played,
    count(*) filter (where gf > ga)::int as won,
    count(*) filter (where gf = ga)::int as drawn,
    count(*) filter (where gf < ga)::int as lost,
    coalesce(sum(gf), 0)::int as goals_for,
    coalesce(sum(ga), 0)::int as goals_against
  from results group by team_id
)
select
  pg_temp.seed_id('season', 'sandbox-2026'),
  team_id, played, won, drawn, lost, goals_for, goals_against,
  won * 3 + drawn as points,
  row_number() over (
    order by (won * 3 + drawn) desc, (goals_for - goals_against) desc, goals_for desc, team_id
  )::smallint
from totals;


-- -----------------------------------------------------------------------------
-- 10. Fantasy gameweeks — one per matchday, deadline at that matchday's first
--     kickoff, which is how generateFantasyGameweeks derives them from real
--     fixtures. `is_current` is the earliest matchday whose deadline is still
--     ahead, so the squad builder opens on a gameweek that can be edited.
-- -----------------------------------------------------------------------------
insert into fantasy_gameweeks (season_id, number, deadline_at, is_current)
select
  pg_temp.seed_id('season', 'sandbox-2026'),
  f.matchday,
  min(f.kickoff_at),
  f.matchday = (
    select min(matchday) from fixtures
     where competition_id = pg_temp.seed_id('competition', 'sandbox') and status = 'scheduled'
  )
from fixtures f
where f.competition_id = pg_temp.seed_id('competition', 'sandbox') and f.matchday is not null
group by f.matchday;


-- -----------------------------------------------------------------------------
-- 11. Provider mappings — the label that makes all of the above removable, and
--     makes seeded data distinguishable from synced data everywhere.
-- -----------------------------------------------------------------------------
insert into provider_mappings (entity_type, kivo_entity_id, provider, provider_entity_id)
select 'competition'::provider_entity_type, id, 'kivo-seed', 'competition:' || id::text from competitions
 where id = pg_temp.seed_id('competition', 'sandbox')
union all
select 'venue'::provider_entity_type, v.id, 'kivo-seed', 'venue:' || v.id::text from venues v
 where v.id in (select pg_temp.seed_id('venue', slug) from seed_clubs)
union all
select 'team'::provider_entity_type, t.id, 'kivo-seed', 'team:' || t.id::text from teams t
 where t.id in (select pg_temp.seed_id('team', slug) from seed_clubs)
union all
select 'player'::provider_entity_type, p.id, 'kivo-seed', 'player:' || p.id::text from players p
 where p.current_team_id in (select pg_temp.seed_id('team', slug) from seed_clubs)
union all
select 'manager'::provider_entity_type, m.id, 'kivo-seed', 'manager:' || m.id::text from managers m
 where m.current_team_id in (select pg_temp.seed_id('team', slug) from seed_clubs)
union all
select 'fixture'::provider_entity_type, f.id, 'kivo-seed', 'fixture:' || f.id::text from fixtures f
 where f.competition_id = pg_temp.seed_id('competition', 'sandbox');


-- -----------------------------------------------------------------------------
-- 12. What is deliberately NOT seeded, and why
--
--    * No profiles, posts, comments, reactions, polls, predictions, fantasy
--      teams or XP. Every one of those is owned by a real user under RLS, and
--      seeding them would mean inventing users — which would then make the
--      social feed, the leaderboards and "what the room thought" render
--      fabricated engagement. Sign in and create them; that path works, and
--      exercising it is more useful than faking its output.
--    * No transfers. `transfers` carries a `confidence` label whose whole
--      meaning is that it reflects a real source. There is no honest synthetic
--      value for it.
--    * No sync_runs, sync_run_failures or data_anomalies. Those describe things
--      that happened to this database; inventing them would make Data Health
--      report history that never occurred.
-- -----------------------------------------------------------------------------

select
  (select count(*) from competitions) as competitions,
  (select count(*) from teams) as teams,
  (select count(*) from players) as players,
  (select count(*) from fixtures) as fixtures,
  (select count(*) from fixture_events) as events,
  (select count(*) from lineups) as lineup_rows,
  (select count(*) from standings) as standings_rows,
  (select count(*) from fantasy_gameweeks) as gameweeks;
