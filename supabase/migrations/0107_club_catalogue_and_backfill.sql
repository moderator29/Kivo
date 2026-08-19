-- =============================================================================
-- 0107 — A club directory that does not depend on who played today
-- =============================================================================
-- THE DEFECT THIS FIXES
-- ---------------------
-- `syncTodayFixtures` was the only thing in KIVO that ever created a
-- competition or a club, and it creates them from ONE DAY'S FIXTURES. Run on a
-- Tuesday in August, that produced the live database's actual contents: 85
-- competitions ("U19 Bundesliga", "Reserve League", "III Liga - Group 2",
-- "Svenska Cupen"), 705 clubs, 0 players, 0 managers, 0 standings. Real Madrid
-- was absent because Real Madrid did not play that day.
--
-- The provider has a better-shaped endpoint for this and KIVO was not using it:
-- `/teams?league={id}&season={y}` returns every club in a competition, with
-- crests, for ONE request — the same price as one day of fixtures, and
-- independent of the calendar. Squads are the expensive half: one request PER
-- CLUB, so a single twenty-club league is twenty requests against a free tier
-- of about a hundred a day.
--
-- That asymmetry is what this migration is shaped around. Clubs are cheap and
-- can be pulled in one go; squads must be pulled a few at a time, over days,
-- resuming where the last run stopped. Three things are needed for that and
-- none of them existed:
--
--   1. somewhere to record which clubs belong to which competition, because
--      until now the ONLY link between a club and a competition in this schema
--      was a fixture — which is the very assumption being removed;
--   2. somewhere to record how far a backfill got, so tomorrow's run continues
--      instead of restarting;
--   3. an allowance in the existing request ledger, so the backfill cannot eat
--      the day's quota in one press or starve the daily fixture sync.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. competition_teams — the club/competition link that fixtures used to imply
-- -----------------------------------------------------------------------------
-- Deliberately per SEASON, not per competition. A club is in the Premier League
-- in one season and the Championship in the next, and a table keyed only on
-- (competition, team) would have to either lose that or lie about it. Seasons
-- already exist in this schema and already carry `is_current`, so "who is in
-- this league right now" is a join, not a guess.
--
-- `first_seen_at` / `last_seen_at` rather than a single timestamp: the pair is
-- what lets a later reader tell a club that has been in the league all along
-- from one that appeared in the most recent refresh, and it is the same
-- convention `fixtures.provider_last_seen_at` already uses to detect a row the
-- provider has stopped reporting. Nothing in this migration acts on that
-- difference; the columns exist so that a future relegation/promotion sweep has
-- real evidence to act on rather than having to re-derive it.
create table if not exists competition_teams (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  season_id      uuid not null references seasons(id) on delete cascade,
  team_id        uuid not null references teams(id) on delete cascade,
  -- Which provider asserted this membership. Two providers can disagree about
  -- a league's composition, and this schema keys mappings per provider
  -- everywhere else (`provider_mappings`, `provider_coverage`) rather than
  -- merging providers into one "best available" answer. Same here.
  provider       text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint competition_teams_provider_not_blank check (length(btrim(provider)) > 0),
  -- One row per club per season per provider. The upsert in
  -- `sync-catalogue.ts` targets exactly this constraint, so re-running a club
  -- sync refreshes `last_seen_at` instead of accumulating duplicates.
  constraint competition_teams_unique unique (provider, season_id, team_id)
);

comment on table competition_teams is
  'Which clubs a provider reports as belonging to a competition in a given season, from /teams?league=&season=. The link that made a club directory possible without a fixture: before this table, the only thing connecting a club to a competition in this schema was a match, so a club that had not played was not in any league. Keyed per season because clubs are promoted and relegated, and per provider because two providers may disagree and this schema never merges them.';
comment on column competition_teams.first_seen_at is
  'When this club was first reported in this competition-season. Never overwritten by a later refresh.';
comment on column competition_teams.last_seen_at is
  'When the most recent club sync still reported this club in this competition-season. A row whose last_seen_at stops advancing is a club the provider has stopped listing — evidence for a future promotion/relegation sweep, not acted on by anything today.';

create index if not exists idx_competition_teams_competition on competition_teams (competition_id, season_id);
create index if not exists idx_competition_teams_team on competition_teams (team_id);

alter table competition_teams enable row level security;

-- Same policy shape as `teams`, `standings` and `competitions`: public football
-- data is readable by any signed-in user, and only a football-data admin may
-- write it through the API. The sync itself writes with the service-role client
-- and bypasses RLS entirely, exactly like every other football table.
create policy competition_teams_select_public on competition_teams
  for select to authenticated using (true);
create policy competition_teams_insert_admin on competition_teams
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy competition_teams_update_admin on competition_teams
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy competition_teams_delete_admin on competition_teams
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


-- -----------------------------------------------------------------------------
-- 2. provider_backfill_state — where the backfill got to
-- -----------------------------------------------------------------------------
-- A backfill bounded by a daily allowance is only useful if it RESUMES. Without
-- a record of what has already been attempted, every press would start at the
-- same club and the same twelve clubs would be re-synced forever while the rest
-- of the league stayed empty. That is not a hypothetical failure mode; it is
-- the default one.
--
-- `last_attempted_at` is written whether the attempt succeeded or failed, and
-- that is the load-bearing part. Ordering the queue by it means a club whose
-- squad request failed goes to the BACK of the queue rather than being retried
-- immediately with the next request — so one club the provider will not serve
-- cannot consume the whole allowance, one request at a time, day after day,
-- while every other club waits behind it.
--
-- `last_succeeded_at` is separate precisely so "we tried" and "it worked" can
-- never be read as the same fact.
create table if not exists provider_backfill_state (
  provider          text not null,
  -- What kind of work this row tracks. Free text with a check rather than an
  -- enum, following `provider_request_spend.bucket`'s reasoning: adding a scope
  -- should be a code change, not a migration plus an enum value that cannot be
  -- used in the same transaction.
  scope             text not null,
  -- The KIVO uuid of the thing being backfilled: a competition for
  -- 'competition_teams', a team for 'team_squad'. Not a foreign key, because
  -- two different tables are referenced depending on `scope` and a
  -- polymorphic FK cannot be expressed; the sync deletes nothing, and a stale
  -- row for a deleted entity is inert (the queue only ever joins FROM the real
  -- table).
  entity_id         uuid not null,
  last_attempted_at timestamptz,
  last_succeeded_at timestamptz,
  -- How many rows the last SUCCESSFUL run wrote. Null until one succeeds.
  records_processed integer,
  -- The provider's or the database's own sentence from the last failure, kept
  -- so an operator can see why a club keeps failing rather than only that it
  -- does. Cleared on a success.
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (provider, scope, entity_id),
  constraint provider_backfill_state_scope_known
    check (scope in ('competition_teams', 'team_squad')),
  constraint provider_backfill_state_provider_not_blank check (length(btrim(provider)) > 0)
);

comment on table provider_backfill_state is
  'Resume points for quota-bounded backfills. A backfill that can only spend a few requests a day is worthless unless it continues tomorrow where it stopped; this is that memory. last_attempted_at is written on failure as well as success, deliberately: it is what sends a failing club to the back of the queue instead of letting it consume the whole allowance on retries.';

-- The queue's only query shape: "for this provider and scope, who has waited
-- longest". Nulls first, so a club never attempted at all is served before one
-- that has been.
create index if not exists idx_provider_backfill_state_queue
  on provider_backfill_state (provider, scope, last_attempted_at nulls first);

alter table provider_backfill_state enable row level security;

-- Operational accounting, not content — same posture as
-- `provider_request_spend` (0094) and `rate_limit_events` (0066). Every write
-- and every read goes through the service-role client, which bypasses RLS. RLS
-- on with no policy means anon and authenticated can do nothing here, which is
-- correct: this is a record of KIVO's own machinery, and the admin surface
-- that displays it is server-rendered with the service-role client.


-- -----------------------------------------------------------------------------
-- 3. The 'catalogue' allowance in the request ledger
-- -----------------------------------------------------------------------------
-- 0094's buckets and the reasoning behind them are unchanged:
--
--   live      55  the once-a-minute worker
--   auto      20  on-demand freshness on page view
--   daily      8  the baseline fixture sync
--   catalogue 12  NEW — the club directory and squad backfill
--             ───
--             95 budgeted, leaving ~5 that no bucket can reach.
--
-- WHY THE BACKFILL IS BUDGETED AT ALL, WHEN ADMIN ACTIONS ARE NOT
-- ---------------------------------------------------------------
-- 0094 deliberately left admin-triggered syncs unbudgeted: a human pressing a
-- button is supervised, and the headroom outside every bucket is what
-- guarantees they always have room to debug. That reasoning holds for "Sync
-- now", which is one request.
--
-- It does not hold for this. A squad backfill is not one request; it is one
-- request per club, and the whole point of pressing it is to keep pressing it
-- until a league is filled in. An unbudgeted button that spends twenty requests
-- per press is a button that empties the day's quota in five presses and takes
-- tomorrow's fixture sync with it — the exact failure 0094 exists to prevent,
-- arriving through the door 0094 left open. So it gets an allowance, and the
-- allowance is what makes it resumable rather than dangerous.
--
-- WHY 12, AND WHY THE HEADROOM SHRINKS TO ~5
-- ------------------------------------------
-- 12 is one competition's club list (1 request) plus eleven squads, or twelve
-- squads. A twenty-club league's squads therefore take a bit under two days,
-- and all seven of the default competitions' club lists fit in a single day
-- with room to spare. Slower than anyone wants; honest on a free tier.
--
-- The remaining ~5 is thinner than 0094's ~17 and that is a real cost, stated
-- rather than hidden. Two things make it acceptable. First, the manual actions
-- that draw on it are small — a fixture sync is 1 request, a full match-detail
-- sync is 3. Second, and unlike every other bucket, THIS ONE GOES QUIET: live,
-- auto and daily spend for as long as KIVO runs, while the catalogue backfill
-- has a finite amount of work and stops asking once the directory is built.
--
-- Raising it is a migration, by the same design 0094 chose: a ceiling a caller
-- can change is not a ceiling.
create or replace function public.provider_request_limit(p_bucket text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_bucket
    when 'live'      then 55
    when 'auto'      then 20
    when 'daily'     then 8
    when 'catalogue' then 12
    -- An unrecognised bucket gets nothing. A typo must fail closed: a bucket
    -- name that silently defaulted to a generous number would be a budget with
    -- a spelling-mistake-shaped hole in it.
    else 0
  end;
$$;

comment on function public.provider_request_limit(text) is
  'The authoritative per-bucket ceiling on automated provider requests in a rolling window. Deliberately a constant here rather than an argument to consume_provider_requests: a caller that supplies its own limit decides its own ceiling, which is not a budget. An unknown bucket returns 0 — a typo fails closed.';

-- `create or replace function` resets privileges to the owner's defaults, so
-- 0094's grants must be restated here or this function becomes executable by
-- roles 0094 deliberately revoked it from.
revoke execute on function public.provider_request_limit(text) from public, anon, authenticated;
grant execute on function public.provider_request_limit(text) to service_role;


-- -----------------------------------------------------------------------------
-- 4. provider_coverage learns what /leagues already told us
-- -----------------------------------------------------------------------------
-- Every competition in the live database has `country = null`, and the UI
-- renders that as "International" — so "III Liga - Group 2" is presented to
-- the founder as an international competition. The provider was never the
-- problem: API-Football sends `league.country` on every `/fixtures` item and
-- `country.name` on every `/leagues` entry, and KIVO's adapter declared neither
-- field and dropped both.
--
-- The fixture-side fix is in the adapter and the sync. These columns are the
-- other half, and they are the cheaper half: `/leagues` is ONE request that
-- returns the name, country, type and badge of every competition the plan can
-- see — including the ones KIVO has never synced a fixture for. That makes the
-- coverage registry the only place KIVO can learn what "league 39" is called
-- and where it is played WITHOUT first spending a request on it, which is
-- exactly what the competition allowlist needs to be verifiable rather than
-- taken on faith.
alter table provider_coverage add column if not exists country text;
alter table provider_coverage add column if not exists competition_type text;
alter table provider_coverage add column if not exists logo_url text;

comment on column provider_coverage.country is
  'The country the provider files this competition under, verbatim from /leagues (continental and international competitions come back as "World"). Null means the provider omitted it, never that KIVO could not be bothered to ask. This is the cheapest source of a competition''s country in the whole API — one request covers every competition the plan can see, synced or not.';
comment on column provider_coverage.competition_type is
  'The provider''s own word for the competition''s shape — API-Football sends "League" or "Cup". Stored verbatim, never derived from the name.';
comment on column provider_coverage.logo_url is
  'Provider-hosted competition badge, when the provider publishes one. Never a KIVO-hosted placeholder.';


-- To reverse:
--   alter table provider_coverage drop column if exists logo_url;
--   alter table provider_coverage drop column if exists competition_type;
--   alter table provider_coverage drop column if exists country;
--   -- restore 0094's three-bucket provider_request_limit(text) definition
--   drop table if exists provider_backfill_state;
--   drop table if exists competition_teams;
