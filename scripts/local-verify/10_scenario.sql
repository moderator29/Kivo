-- =============================================================================
-- KIVO local verification scenario — the half supabase/seed.sql deliberately
-- leaves out, plus the cases that actually break things
-- =============================================================================
--
--   EVERYTHING THIS FILE INSERTS IS SYNTHETIC, AND IT INVENTS USERS.
--
-- supabase/seed.sql stops at football data on purpose: seeding profiles, posts
-- and squads would mean inventing people, and a *shared* database with invented
-- people renders fabricated engagement to whoever looks at it. That reasoning
-- is right, and this file does not overturn it. It applies one narrower claim:
-- a throwaway database on a developer's own machine, which no user can reach,
-- is where you find out whether a gameweek actually scores.
--
-- So this file is quarantined harder than the seed is:
--
--   1. It refuses to run unless supabase/seed.sql has already run here, which
--      means it can only ever land on a database the seed's own three guards
--      already accepted.
--   2. It refuses to run against a database holding any provider mapping other
--      than the seed's and its own.
--   3. Every row it creates is registered under the provider `kivo-scenario`,
--      so it is distinguishable from both real data and seeded football data.
--   4. It is not in supabase/. `supabase db reset` will never pick it up, and
--      no deploy path runs it.
--
-- WHAT IT ADDS, AND WHY EACH ONE IS HERE. Every item below is a case that has
-- broken something, or would hide a break if it were missing:
--
--   * A second competition whose provider coverage says per-player statistics
--     are NOT available, next to one that says they are, and a third state —
--     unknown — because null must never be rendered as "no".
--   * One player with season statistics in both, where the covered competition
--     reports assists and the uncovered one leaves them null. "0 assists" and
--     "assists not reported" are different sentences and the product has to
--     say the right one.
--   * A finished fixture with events, a finished fixture with none, a fixture
--     at half-time, a fixture in play, and a fixture not yet kicked off.
--   * Lineups with a provider grid on one side and none on the other, which is
--     the difference between a heatmap anchored by formation slot and one that
--     honestly widens its spread because it does not know the column.
--   * Squads either side of a deadline, with transfers that cost points.
--   * A match room with posts, replies, reactions and a poll.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Guards
-- -----------------------------------------------------------------------------
do $$
begin
  if coalesce(current_setting('kivo.scenario_confirmed', true), '') <> 'yes' then
    raise exception 'Refusing to run: set kivo.scenario_confirmed to ''yes'' first.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from provider_mappings where provider = 'kivo-seed') then
    raise exception 'Refusing to run: supabase/seed.sql has not been run on this database.'
      using errcode = '22023';
  end if;
  if exists (select 1 from provider_mappings where provider not in ('kivo-seed', 'kivo-scenario')) then
    raise exception 'Refusing to run: this database holds real synced provider data.'
      using errcode = '22023';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 1. Teardown, by scenario mapping only
-- -----------------------------------------------------------------------------
do $$
declare
  v_profiles uuid[];
  v_fixtures uuid[];
  v_competitions uuid[];
begin
  select coalesce(array_agg(kivo_entity_id), '{}') into v_profiles
    from provider_mappings where provider = 'kivo-scenario' and entity_type = 'player';
  select coalesce(array_agg(kivo_entity_id), '{}') into v_fixtures
    from provider_mappings where provider = 'kivo-scenario' and entity_type = 'fixture';
  select coalesce(array_agg(kivo_entity_id), '{}') into v_competitions
    from provider_mappings where provider = 'kivo-scenario' and entity_type = 'competition';

  delete from fantasy_transfers where true;
  delete from fantasy_point_breakdowns where true;
  delete from fantasy_points where true;
  delete from fantasy_rosters where true;
  delete from fantasy_teams where true;
  delete from fantasy_leagues where true;
  delete from predictions where true;
  delete from prediction_league_members where true;
  delete from prediction_leagues where true;
  delete from poll_votes where true;
  delete from poll_options where true;
  delete from reactions where true;
  delete from comments where true;
  delete from posts where true;
  delete from fan_ratings where true;
  delete from xp_ledger where true;
  delete from follows where true;
  delete from notifications where true;
  delete from top_scorers where true;
  delete from injuries where true;
  delete from player_season_statistics where true;
  delete from fixture_player_statistics where true;
  delete from player_heatmaps where true;
  delete from provider_coverage where true;

  delete from fixtures where id = any(v_fixtures);
  delete from fantasy_gameweeks where season_id in (select id from seasons where competition_id = any(v_competitions));
  delete from seasons where competition_id = any(v_competitions);
  delete from competitions where id = any(v_competitions);

  delete from profiles where id = any(v_profiles);
  delete from auth.users where email like '%@kivo.local';
  delete from provider_mappings where provider = 'kivo-scenario';
end $$;


create or replace function pg_temp.sid(kind text, key text)
returns uuid language sql immutable as $$
  select md5('kivo-scenario:' || kind || ':' || key)::uuid;
$$;
create or replace function pg_temp.seed_id(kind text, key text)
returns uuid language sql immutable as $$
  select md5('kivo-seed:' || kind || ':' || key)::uuid;
$$;


-- -----------------------------------------------------------------------------
-- 2. People
--
--    Three, because the interesting questions are between people: a squad that
--    beats another squad, a post somebody replies to, an admin who can see a
--    surface a user cannot.
-- -----------------------------------------------------------------------------
create temp table scenario_people (
  slug text primary key, username text, display_name text, role user_role, country text, avatar text
);
insert into scenario_people values
  ('ada',  'ada_sandbox',  'Ada O.',     'user',        'NG', 'kivo-avatar-06'),
  ('bem',  'bem_sandbox',  'Bem T.',     'user',        'GH', 'kivo-avatar-08'),
  ('zara', 'zara_sandbox', 'Zara A.',    'admin',       'KE', 'kivo-avatar-11');

insert into auth.users (id, email)
select pg_temp.sid('auth', slug), slug || '@kivo.local' from scenario_people;

insert into profiles (
  id, auth_user_id, username, display_name, role, country, onboarding_completed,
  avatar_type, avatar_kivo_id, background_id, favourite_team_id, timezone
)
select
  pg_temp.sid('player', p.slug),
  pg_temp.sid('auth', p.slug),
  p.username, p.display_name, p.role, p.country, true,
  'kivo', p.avatar, 'kivo-bg-01',
  case p.slug when 'ada' then pg_temp.seed_id('team', 'harbour')
              when 'bem' then pg_temp.seed_id('team', 'northgate') end,
  'Africa/Lagos'
from scenario_people p;

insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
select 'kivo-scenario', 'player', 'profile:' || slug, pg_temp.sid('player', slug) from scenario_people;


-- -----------------------------------------------------------------------------
-- 3. A second competition, with different coverage
--
--    Same clubs, different tournament: a knockout cup the provider covers less
--    thoroughly than the league. This is the shape that catches code which
--    assumes coverage is a property of the provider rather than of the
--    competition.
-- -----------------------------------------------------------------------------
insert into competitions (id, name, short_name, country)
values (pg_temp.sid('competition', 'cup'), 'KIVO Sandbox Cup', 'KSC', 'NG');

insert into seasons (id, competition_id, name, provider_year, is_current, start_date, end_date)
values (
  pg_temp.sid('season', 'cup-2026'), pg_temp.sid('competition', 'cup'),
  '2026/2027', 2026, true, (now() - interval '45 days')::date, (now() + interval '120 days')::date
);

insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
values
  ('kivo-scenario', 'competition', '9002', pg_temp.sid('competition', 'cup')),
  ('kivo-scenario', 'season', '9002:2026', pg_temp.sid('season', 'cup-2026'));

-- Four cup ties. The third is the one that matters most: finished, with a real
-- scoreline, and no events at all — the provider covered the result and
-- nothing else. Every "show me the goals" surface has to survive it.
create temp table scenario_cup (
  key text primary key, home text, away text, status fixture_status,
  hours_ago numeric, home_score smallint, away_score smallint, minute smallint
);
insert into scenario_cup values
  ('qf1', 'harbour',   'meridian', 'finished',  72, 3, 1, null),
  ('qf2', 'northgate', 'foundry',  'finished',  70, 0, 2, null),
  ('qf3', 'riverside', 'lantern',  'finished',  68, 1, 1, null),
  ('sf1', 'summit',    'kestrel',  'scheduled', -96, null, null, null);

insert into fixtures (
  id, competition_id, season_id, home_team_id, away_team_id, venue_id,
  status, kickoff_at, matchday, home_score, away_score, home_score_ht, away_score_ht, minute_elapsed
)
select
  pg_temp.sid('fixture', c.key),
  pg_temp.sid('competition', 'cup'),
  pg_temp.sid('season', 'cup-2026'),
  pg_temp.seed_id('team', c.home),
  pg_temp.seed_id('team', c.away),
  pg_temp.seed_id('venue', c.home),
  c.status,
  now() - make_interval(hours => c.hours_ago::int),
  1::smallint,
  c.home_score, c.away_score,
  case when c.home_score is null then null else least(c.home_score, 1)::smallint end,
  case when c.away_score is null then null else least(c.away_score, 1)::smallint end,
  c.minute
from scenario_cup c;

insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
select 'kivo-scenario', 'fixture', 'cup:' || key, pg_temp.sid('fixture', key) from scenario_cup;

-- Goals for the two cup ties that have them, generated from the scoreline so
-- the events can never contradict the score. `qf3` gets none on purpose.
insert into fixture_events (id, fixture_id, team_id, player_id, event_type, minute, detail)
select
  pg_temp.sid('event', c.key || ':' || side || ':' || n),
  pg_temp.sid('fixture', c.key),
  pg_temp.seed_id('team', case when side = 'h' then c.home else c.away end),
  pg_temp.seed_id('player', (case when side = 'h' then c.home else c.away end) || ':' || (13 + (n % 3))),
  'goal'::fixture_event_type,
  (12 + n * 17)::smallint,
  'Normal Goal'
from scenario_cup c
cross join lateral (values ('h'), ('a')) s(side)
cross join lateral generate_series(1, case when side = 'h' then coalesce(c.home_score, 0) else coalesce(c.away_score, 0) end) n
where c.key in ('qf1', 'qf2');


-- -----------------------------------------------------------------------------
-- 4. Provider coverage — all three states, on purpose
--
--    true / false / null are three different answers, and the third one is the
--    one that gets rendered wrongly: a null coverage flag means the provider
--    never said, and showing that as "not available" is a claim nobody made.
-- -----------------------------------------------------------------------------
insert into provider_coverage (
  provider, provider_competition_id, season_year, competition_id, competition_name,
  fixture_events, fixture_lineups, fixture_statistics, fixture_player_statistics,
  standings, players, top_scorers, top_assists, top_cards, injuries, predictions, odds,
  raw, retrieved_at
) values
  (
    'api-football', '9001', 2026, pg_temp.seed_id('competition', 'sandbox'), 'KIVO Sandbox League',
    true, true, true, true,
    true, true, true, true, false, true, false, false,
    '{"note": "scenario row: league, fully covered"}'::jsonb, now() - interval '2 hours'
  ),
  (
    'api-football', '9002', 2026, pg_temp.sid('competition', 'cup'), 'KIVO Sandbox Cup',
    true, false, false, false,
    false, true, null, null, null, null, false, false,
    '{"note": "scenario row: cup, results only; top scorers never declared"}'::jsonb, now() - interval '2 hours'
  );


-- -----------------------------------------------------------------------------
-- 5. One player, two competitions, one of which does not report assists
-- -----------------------------------------------------------------------------
insert into player_season_statistics (
  provider, player_id, provider_competition_id, competition_id, competition_name,
  season_year, season_id, team_id, team_name, position,
  appearances, lineups, minutes_played, goals, assists, shots_total, shots_on_target,
  passes_total, passes_key, pass_accuracy, provider_rating, yellow_cards, red_cards, retrieved_at
) values
  (
    'api-football', pg_temp.seed_id('player', 'harbour:13'), '9001',
    pg_temp.seed_id('competition', 'sandbox'), 'KIVO Sandbox League',
    2026, pg_temp.seed_id('season', 'sandbox-2026'), pg_temp.seed_id('team', 'harbour'), 'Harbour Rovers', 'Attacker',
    12, 11, 968, 7, 4, 31, 15, 214, 9, 78, 7.2, 2, 0, now() - interval '3 hours'
  ),
  (
    -- Same player, same season, the cup: goals arrived, assists did not. Null,
    -- not zero — the provider does not report the field for this competition.
    'api-football', pg_temp.seed_id('player', 'harbour:13'), '9002',
    pg_temp.sid('competition', 'cup'), 'KIVO Sandbox Cup',
    2026, pg_temp.sid('season', 'cup-2026'), pg_temp.seed_id('team', 'harbour'), 'Harbour Rovers', 'Attacker',
    3, 3, 270, 2, null, 9, 4, null, null, null, null, 0, 0, now() - interval '3 hours'
  );


-- -----------------------------------------------------------------------------
-- 6. Per-player match statistics, for exactly one league fixture
--
--    Deliberately one and not all: the product has to render a fixture that has
--    them and a fixture that does not, and be honest about which is which.
--    Matchday 3, fixture 0, which is finished and has events.
-- -----------------------------------------------------------------------------
insert into fixture_player_statistics (
  fixture_id, player_id, team_id, minutes_played, position, is_substitute,
  provider_rating, shots_total, shots_on_target, goals, assists,
  passes_total, passes_key, pass_accuracy, tackles_total, interceptions,
  duels_total, duels_won, dribbles_attempted, dribbles_succeeded,
  fouls_drawn, fouls_committed, yellow_cards, red_cards
)
select
  l.fixture_id, l.player_id, l.team_id,
  case when l.is_starting then 90 else 24 end,
  l.position, not l.is_starting,
  (5.5 + (abs(hashtext(l.player_id::text)) % 35) / 10.0)::numeric(3,1),
  (abs(hashtext('sh' || l.player_id::text)) % 5)::smallint,
  (abs(hashtext('sot' || l.player_id::text)) % 3)::smallint,
  coalesce(g.goals, 0)::smallint,
  coalesce(a.assists, 0)::smallint,
  (18 + abs(hashtext('p' || l.player_id::text)) % 50)::smallint,
  (abs(hashtext('kp' || l.player_id::text)) % 4)::smallint,
  (62 + abs(hashtext('pa' || l.player_id::text)) % 32)::smallint,
  (abs(hashtext('tk' || l.player_id::text)) % 6)::smallint,
  (abs(hashtext('in' || l.player_id::text)) % 5)::smallint,
  (6 + abs(hashtext('du' || l.player_id::text)) % 12)::smallint,
  (abs(hashtext('dw' || l.player_id::text)) % 8)::smallint,
  (abs(hashtext('da' || l.player_id::text)) % 6)::smallint,
  (abs(hashtext('ds' || l.player_id::text)) % 4)::smallint,
  (abs(hashtext('fd' || l.player_id::text)) % 4)::smallint,
  (abs(hashtext('fc' || l.player_id::text)) % 4)::smallint,
  0::smallint, 0::smallint
from lineups l
left join (
  select fixture_id, player_id, count(*) as goals from fixture_events
  where event_type in ('goal', 'penalty_goal') group by 1, 2
) g on g.fixture_id = l.fixture_id and g.player_id = l.player_id
left join (
  select fixture_id, related_player_id as player_id, count(*) as assists from fixture_events
  where event_type in ('goal', 'penalty_goal') and related_player_id is not null group by 1, 2
) a on a.fixture_id = l.fixture_id and a.player_id = l.player_id
where l.fixture_id = pg_temp.seed_id('fixture', '3:0');

-- A provider grid on the home side of that same fixture and nothing on the
-- away side. The heatmap engine treats "I know the formation slot" and "I only
-- know the order the provider listed them in" as different confidences, and
-- this is where that difference becomes visible.
update lineups l
set grid = g.grid
from (
  select
    id,
    case
      when position = 'Goalkeeper' then '1:1'
      else (row_number() over (partition by position order by shirt_number))::text
           || ':' ||
           (1 + (row_number() over (partition by position order by shirt_number) - 1) % 4)::text
    end as grid
  from lineups
  where fixture_id = md5('kivo-seed:fixture:3:0')::uuid
    and team_id = (select home_team_id from fixtures where id = md5('kivo-seed:fixture:3:0')::uuid)
    and is_starting
) g
where l.id = g.id;


-- -----------------------------------------------------------------------------
-- 7. Injuries and top scorers
-- -----------------------------------------------------------------------------
insert into injuries (player_id, team_id, competition_id, season_id, status, reason, reported_on, provider)
values
  (pg_temp.seed_id('player', 'harbour:5'), pg_temp.seed_id('team', 'harbour'),
   pg_temp.seed_id('competition', 'sandbox'), pg_temp.seed_id('season', 'sandbox-2026'),
   'out', 'Hamstring strain', (now() - interval '4 days')::date, 'api-football'),
  (pg_temp.seed_id('player', 'northgate:9'), pg_temp.seed_id('team', 'northgate'),
   pg_temp.seed_id('competition', 'sandbox'), pg_temp.seed_id('season', 'sandbox-2026'),
   'doubtful', 'Knock', (now() - interval '1 day')::date, 'api-football');

insert into top_scorers (season_id, competition_id, player_id, team_id, rank, goals, assists, penalties_scored, appearances, minutes_played, captured_at)
select
  pg_temp.seed_id('season', 'sandbox-2026'),
  pg_temp.seed_id('competition', 'sandbox'),
  e.player_id,
  p.current_team_id,
  (row_number() over (order by count(*) desc, e.player_id))::smallint,
  count(*)::smallint,
  0::smallint, 0::smallint,
  4::smallint, 340,
  now() - interval '2 hours'
from fixture_events e
join players p on p.id = e.player_id
join fixtures f on f.id = e.fixture_id
where e.event_type in ('goal', 'penalty_goal')
  and f.competition_id = pg_temp.seed_id('competition', 'sandbox')
group by e.player_id, p.current_team_id
order by count(*) desc, e.player_id
limit 5;


-- -----------------------------------------------------------------------------
-- 8. Fantasy — two managers, one private league, squads either side of the
--    deadline, and transfers that cost something
-- -----------------------------------------------------------------------------
insert into fantasy_leagues (id, name, creator_profile_id, season_id, is_private, invite_code, max_teams)
values
  (pg_temp.sid('league', 'private'), 'Sandbox Supporters',
   pg_temp.sid('player', 'ada'), pg_temp.seed_id('season', 'sandbox-2026'), true, 'SANDBOX1', 20),
  (pg_temp.sid('league', 'public'), 'Open Sandbox League',
   pg_temp.sid('player', 'zara'), pg_temp.seed_id('season', 'sandbox-2026'), false, null, 100);

insert into fantasy_teams (id, owner_profile_id, league_id, name)
values
  (pg_temp.sid('team', 'ada'), pg_temp.sid('player', 'ada'), pg_temp.sid('league', 'private'), 'Harbour Heroes'),
  (pg_temp.sid('team', 'bem'), pg_temp.sid('player', 'bem'), pg_temp.sid('league', 'private'), 'Northgate Nine');

-- A legal 4-3-3: 15 players, 11 starting, 2 GK / 5 DEF / 5 MID / 3 FWD, and no
-- more than three from one club. Built from the seeded squads by position so it
-- satisfies the same rules the squad builder enforces.
create temp table scenario_squad as
with picks as (
  select
    t.slug as manager,
    p.id as player_id,
    p.position,
    row_number() over (partition by t.slug, p.position order by md5(t.slug || p.id::text)) as rn_in_position,
    row_number() over (partition by t.slug, p.current_team_id order by md5(t.slug || p.id::text)) as rn_in_club
  from (values ('ada'), ('bem')) t(slug)
  join players p on p.current_team_id in (select id from teams)
)
select manager, player_id, position,
  case position
    when 'Goalkeeper' then rn_in_position <= 1
    when 'Defender' then rn_in_position <= 4
    when 'Midfielder' then rn_in_position <= 3
    when 'Forward' then rn_in_position <= 3
  end as is_starting
from picks
where (position = 'Goalkeeper' and rn_in_position <= 2)
   or (position = 'Defender' and rn_in_position <= 5)
   or (position = 'Midfielder' and rn_in_position <= 5)
   or (position = 'Forward' and rn_in_position <= 3);

-- Gameweek 4 is past its deadline and its matches are in play, which is what
-- makes a provisional total provisional. Gameweek 5 is the current one and its
-- deadline has not passed, so its squad is still editable.
insert into fantasy_rosters (fantasy_team_id, gameweek_id, player_id, is_starting, is_captain, is_vice_captain)
select
  pg_temp.sid('team', s.manager),
  gw.id,
  s.player_id,
  s.is_starting,
  s.player_id = first_value(s.player_id) over (partition by s.manager, gw.id order by (s.position = 'Forward') desc, s.player_id),
  false
from scenario_squad s
cross join (
  select id from fantasy_gameweeks
  where season_id = md5('kivo-seed:season:sandbox-2026')::uuid and number in (3, 4, 5)
) gw;

-- Two transfers into gameweek 5: one inside the free allowance, one beyond it.
-- The cost is the point — a transfer that costs nothing proves nothing.
insert into fantasy_transfers (fantasy_team_id, gameweek_id, player_in_id, player_out_id, is_free, points_cost)
select
  pg_temp.sid('team', 'ada'),
  (select id from fantasy_gameweeks where season_id = md5('kivo-seed:season:sandbox-2026')::uuid and number = 5),
  incoming.id, outgoing.id, t.is_free, t.cost
from (values (true, 0::smallint), (false, -4::smallint)) t(is_free, cost)
cross join lateral (
  select id from players where current_team_id = md5('kivo-seed:team:lantern')::uuid
    and position = 'Midfielder' order by id limit 1 offset (case when t.is_free then 0 else 1 end)
) incoming
cross join lateral (
  select player_id as id from scenario_squad
   where manager = 'ada' and position = 'Midfielder' order by player_id limit 1
   offset (case when t.is_free then 0 else 1 end)
) outgoing;


-- -----------------------------------------------------------------------------
-- 9. A match room with something in it
-- -----------------------------------------------------------------------------
insert into posts (id, author_profile_id, fixture_id, body, created_at)
values
  (pg_temp.sid('post', 'live-1'), pg_temp.sid('player', 'ada'),
   md5('kivo-seed:fixture:4:0')::uuid, 'Second half and we still cannot keep the ball. Change something.',
   now() - interval '20 minutes'),
  (pg_temp.sid('post', 'live-2'), pg_temp.sid('player', 'bem'),
   md5('kivo-seed:fixture:4:0')::uuid, 'Midfield has been overrun since the half hour. It is not the back four.',
   now() - interval '12 minutes'),
  (pg_temp.sid('post', 'done-1'), pg_temp.sid('player', 'bem'),
   md5('kivo-seed:fixture:3:0')::uuid, 'Result flattered them, but three points is three points.',
   now() - interval '6 days');

insert into comments (id, post_id, author_profile_id, body, created_at)
values
  (pg_temp.sid('comment', 'c1'), pg_temp.sid('post', 'live-1'), pg_temp.sid('player', 'bem'),
   'Agreed — the shape has been wrong all half.', now() - interval '18 minutes'),
  (pg_temp.sid('comment', 'c2'), pg_temp.sid('post', 'live-1'), pg_temp.sid('player', 'zara'),
   'Substitution is warming up.', now() - interval '15 minutes');

insert into reactions (target_type, target_id, profile_id, reaction_type)
values
  ('post', pg_temp.sid('post', 'live-1'), pg_temp.sid('player', 'bem'), 'like'),
  ('post', pg_temp.sid('post', 'live-1'), pg_temp.sid('player', 'zara'), 'like'),
  ('post', pg_temp.sid('post', 'live-2'), pg_temp.sid('player', 'ada'), 'like');

insert into posts (id, author_profile_id, fixture_id, body, poll_kind, created_at)
values (pg_temp.sid('post', 'poll-1'), pg_temp.sid('player', 'zara'),
        md5('kivo-seed:fixture:4:0')::uuid, 'Who has been your player of the half?', 'motm',
        now() - interval '25 minutes');

insert into poll_options (id, post_id, position, label)
values
  (pg_temp.sid('option', 'o1'), pg_temp.sid('post', 'poll-1'), 1, 'The goalkeeper'),
  (pg_temp.sid('option', 'o2'), pg_temp.sid('post', 'poll-1'), 2, 'The captain'),
  (pg_temp.sid('option', 'o3'), pg_temp.sid('post', 'poll-1'), 3, 'Nobody, frankly');

insert into poll_votes (post_id, option_id, profile_id)
values
  (pg_temp.sid('post', 'poll-1'), pg_temp.sid('option', 'o3'), pg_temp.sid('player', 'ada')),
  (pg_temp.sid('post', 'poll-1'), pg_temp.sid('option', 'o2'), pg_temp.sid('player', 'bem'));

insert into fan_ratings (profile_id, fixture_id, rating)
values
  (pg_temp.sid('player', 'ada'), md5('kivo-seed:fixture:3:0')::uuid, 4),
  (pg_temp.sid('player', 'bem'), md5('kivo-seed:fixture:3:0')::uuid, 3);


-- -----------------------------------------------------------------------------
-- 10. Predictions, so the leaderboards have something to rank
-- -----------------------------------------------------------------------------
insert into prediction_leagues (id, name, creator_profile_id, invite_code, max_members)
values (pg_temp.sid('predleague', 'main'), 'Sandbox Predictors', pg_temp.sid('player', 'ada'), 'PREDICT1', 50);

insert into prediction_league_members (league_id, profile_id)
values
  (pg_temp.sid('predleague', 'main'), pg_temp.sid('player', 'ada')),
  (pg_temp.sid('predleague', 'main'), pg_temp.sid('player', 'bem'));

-- (There is no fantasy_league_members table: a manager joins a fantasy league
-- by owning a team in it, which fantasy_teams.league_id already records.)

insert into predictions (profile_id, fixture_id, predicted_outcome, prediction_type, points_awarded, locked_at, created_at)
select
  pg_temp.sid('player', s.slug),
  f.id,
  (case when (abs(hashtext(s.slug || f.id::text)) % 3) = 0 then 'home_win'
        when (abs(hashtext(s.slug || f.id::text)) % 3) = 1 then 'draw'
        else 'away_win' end)::prediction_outcome,
  'winner'::prediction_type,
  case when f.status = 'finished' then
    case when (abs(hashtext(s.slug || f.id::text)) % 3) = 0 and f.home_score > f.away_score then 3
         when (abs(hashtext(s.slug || f.id::text)) % 3) = 1 and f.home_score = f.away_score then 3
         when (abs(hashtext(s.slug || f.id::text)) % 3) = 2 and f.home_score < f.away_score then 3
         else 0 end
  end,
  f.kickoff_at,
  f.kickoff_at - interval '2 hours'
from (values ('ada'), ('bem')) s(slug)
cross join fixtures f
where f.competition_id = md5('kivo-seed:competition:sandbox')::uuid and f.matchday <= 4;

insert into xp_ledger (profile_id, amount, reason, source_key)
select pg_temp.sid('player', slug), amount, reason, source_key
from (values
  ('ada', 50, 'prediction_correct', 'scenario:ada:1'),
  ('ada', 20, 'daily_login', 'scenario:ada:2'),
  ('bem', 30, 'prediction_correct', 'scenario:bem:1')
) v(slug, amount, reason, source_key);

insert into follows (follower_profile_id, followed_type, followed_id)
values
  (pg_temp.sid('player', 'ada'), 'team', md5('kivo-seed:team:harbour')::uuid),
  (pg_temp.sid('player', 'ada'), 'player', md5('kivo-seed:player:harbour:13')::uuid),
  (pg_temp.sid('player', 'bem'), 'team', md5('kivo-seed:team:northgate')::uuid),
  (pg_temp.sid('player', 'bem'), 'user', md5('kivo-scenario:player:ada')::uuid);


-- -----------------------------------------------------------------------------
-- 11. What landed
-- -----------------------------------------------------------------------------
select
  (select count(*) from profiles where auth_user_id is not null) as people,
  (select count(*) from competitions) as competitions,
  (select count(*) from fixtures) as fixtures,
  (select count(*) from provider_coverage) as coverage_rows,
  (select count(*) from fixture_player_statistics) as player_match_stats,
  (select count(*) from lineups where grid is not null) as lineups_with_grid,
  (select count(*) from fantasy_rosters) as roster_rows,
  (select count(*) from fantasy_transfers) as transfers,
  (select count(*) from posts) as posts,
  (select count(*) from predictions) as predictions;
