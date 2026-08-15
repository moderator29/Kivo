-- =============================================================================
-- KIVO core schema + RLS
-- =============================================================================
-- Identity authority: Clerk (auth/sessions/social login happen entirely
-- outside Supabase). Supabase holds application data only, using Supabase's
-- native third-party auth integration: Clerk-issued JWTs are verified
-- directly via JWKS (Authentication -> Third Party Auth in the Supabase
-- dashboard/config, configured out-of-band from this migration). RLS reads
-- the Clerk user id from auth.jwt() ->> 'sub'. Supabase Auth (auth.users,
-- auth.uid()) is not used anywhere in this schema; every user-owned table
-- traces back to profiles.clerk_user_id instead.
--
-- This migration assumes Supabase's default grants (anon/authenticated get
-- table-level SELECT/INSERT/UPDATE/DELETE via ALTER DEFAULT PRIVILEGES on
-- the public schema) are already in place project-wide. RLS policies below
-- are therefore the real access boundary, not table-level GRANTs.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Extensions & schemas
-- -----------------------------------------------------------------------------

-- gen_random_uuid() is built into Postgres core (>=13); Supabase ships >=15,
-- so no pgcrypto/uuid-ossp extension is required for primary keys.

create extension if not exists citext; -- case-insensitive uniqueness for usernames

-- Helper functions live in a schema PostgREST never exposes (only schemas
-- listed in the API's exposed-schemas config are reachable over HTTP/RPC;
-- `private` is deliberately not one of them). This keeps role-check helpers
-- out of the public API surface while still being callable from RLS policies.
create schema if not exists private;


-- -----------------------------------------------------------------------------
-- 1. Enum types (declared up front, grouped by the domain that owns them)
-- -----------------------------------------------------------------------------

create type user_role as enum (
  'user',
  'moderator',
  'admin',
  'super_admin',
  'football_data_admin',
  'content_admin',
  'support_admin',
  'analyst'
);

create type follow_target_type as enum ('team', 'player', 'competition', 'user');

create type fixture_status as enum (
  'scheduled', 'live', 'halftime', 'finished', 'postponed', 'cancelled', 'abandoned'
);

create type fixture_event_type as enum (
  'goal', 'own_goal', 'penalty_goal', 'penalty_missed',
  'yellow_card', 'second_yellow_card', 'red_card',
  'substitution', 'var_review'
);

create type provider_entity_type as enum (
  'competition', 'season', 'team', 'player', 'manager', 'venue', 'fixture', 'fixture_event'
);

create type sync_status as enum ('running', 'success', 'partial', 'failed');

create type reaction_target_type as enum ('post', 'comment');

create type reaction_type as enum ('like', 'fire', 'clap', 'laugh', 'wow', 'sad');

-- Shared by reports and moderation_actions: both point at the same kinds of
-- reportable/moderatable content, so one enum avoids drift between the two.
create type moderation_target_type as enum ('post', 'comment', 'profile');

create type report_status as enum ('pending', 'reviewing', 'actioned', 'dismissed');

create type prediction_outcome as enum ('home_win', 'draw', 'away_win');

create type ai_message_role as enum ('system', 'user', 'assistant', 'tool');

create type delivery_channel as enum ('push', 'email', 'sms', 'in_app');

create type delivery_status as enum ('pending', 'sent', 'delivered', 'failed');


-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every UPDATE
-- -----------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =============================================================================
-- 2. IDENTITY / PROFILE
-- =============================================================================

create table profiles (
  id                    uuid primary key default gen_random_uuid(),
  clerk_user_id         text not null unique,
  username              citext not null unique,
  display_name          text,
  avatar_url            text,
  bio                   text,
  country               text,                         -- ISO 3166-1 alpha-2
  favourite_team_id     uuid,                          -- FK added after `teams` exists, below
  onboarding_completed  boolean not null default false,
  role                  user_role not null default 'user',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username::text) between 3 and 24),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 500),
  constraint profiles_country_format check (country is null or country ~ '^[A-Z]{2}$')
);

create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

create index idx_profiles_favourite_team_id on profiles (favourite_team_id);

-- Auth helpers. SECURITY DEFINER is required, not optional: an admin-visibility
-- policy on `profiles` needs to know the caller's role, which means reading
-- `profiles` from inside a policy that is itself gating `profiles`. Evaluated
-- as the calling role that recurses into RLS again and Postgres will raise
-- "infinite recursion detected in policy". Running the lookup as the (trusted,
-- table-owning) function owner instead bypasses RLS for just this internal
-- read, breaking the cycle. search_path is pinned to block search-path
-- hijacking of a SECURITY DEFINER function.
create or replace function private.current_clerk_user_id()
returns text
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '');
$$;

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from profiles where clerk_user_id = private.current_clerk_user_id();
$$;

create or replace function private.current_role()
returns user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from profiles where clerk_user_id = private.current_clerk_user_id();
$$;

-- Shorthand for the two platform-wide admin tiers (used by audit_log,
-- provider infra, and as a catch-all override on owner-only tables).
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(private.current_role() in ('admin', 'super_admin'), false);
$$;

-- General-purpose "does the caller hold one of these roles" check, for the
-- domain-specific admin roles (football_data_admin, content_admin, ...)
-- that only need elevated access to one slice of the schema.
create or replace function private.has_role(roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(private.current_role()::text = any(roles), false);
$$;

grant usage on schema private to authenticated, anon;
grant execute on all functions in schema private to authenticated, anon;

alter table profiles enable row level security;

-- Deliberately owner + admin only, not public — see prompt: profiles is in
-- the owner-only table group, unlike posts/comments/reactions. A public
-- profile page can be served later via a narrow SECURITY DEFINER view/RPC
-- exposing only non-sensitive columns, without loosening this base policy.
create policy profiles_select_own on profiles
  for select to authenticated
  using (clerk_user_id = private.current_clerk_user_id());

create policy profiles_select_admin on profiles
  for select to authenticated
  using (private.is_admin());

-- Row provisioning ideally happens server-side (a Clerk webhook using the
-- service_role key, which bypasses RLS) rather than a client insert; this
-- policy exists as defense-in-depth for a direct client-side upsert path.
-- WITH CHECK pins role to 'user' so nobody can self-provision as an admin.
create policy profiles_insert_own on profiles
  for insert to authenticated
  with check (clerk_user_id = private.current_clerk_user_id() and role = 'user');

-- WITH CHECK compares the new row's role to private.current_role(), which
-- (evaluated mid-statement) still reflects the pre-update stored value. That
-- makes this a "role cannot change via self-service update" guard without
-- needing a trigger or column-level GRANT/REVOKE: users can freely edit
-- bio/avatar/etc, but flipping their own `role` fails the check.
create policy profiles_update_own on profiles
  for update to authenticated
  using (clerk_user_id = private.current_clerk_user_id())
  with check (clerk_user_id = private.current_clerk_user_id() and role = private.current_role());

create policy profiles_update_admin on profiles
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- No delete policy for authenticated: account deletion is a server-side flow
-- (must also deactivate the Clerk user), not a direct table delete. Admins
-- get an explicit escape hatch for support-driven removals.
create policy profiles_delete_admin on profiles
  for delete to authenticated
  using (private.is_admin());


create table notification_preferences (
  profile_id                    uuid primary key references profiles (id) on delete cascade,
  email_enabled                 boolean not null default true,
  push_enabled                  boolean not null default true,
  in_app_enabled                boolean not null default true,
  marketing_emails_enabled      boolean not null default false,
  match_alerts_enabled          boolean not null default true,
  social_alerts_enabled         boolean not null default true,
  prediction_alerts_enabled     boolean not null default true,
  fantasy_alerts_enabled        boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create trigger trg_notification_preferences_updated_at before update on notification_preferences
  for each row execute function set_updated_at();

alter table notification_preferences enable row level security;

create policy notification_preferences_all_own on notification_preferences
  for all to authenticated
  using (profile_id = private.current_profile_id())
  with check (profile_id = private.current_profile_id());


create table follows (
  id                  uuid primary key default gen_random_uuid(),
  follower_profile_id uuid not null references profiles (id) on delete cascade,
  followed_type       follow_target_type not null,
  followed_id         uuid not null, -- polymorphic: team/player/competition/profiles(id) depending on followed_type
  created_at          timestamptz not null default now(),
  constraint follows_unique unique (follower_profile_id, followed_type, followed_id),
  constraint follows_no_self_follow check (
    not (followed_type = 'user' and followed_id = follower_profile_id)
  )
);

-- followed_id is polymorphic (no single target table), so referential
-- integrity across it is an application-layer / future-trigger concern, not
-- a DB-level FK. Noted rather than silently accepted.
create index idx_follows_follower on follows (follower_profile_id);
create index idx_follows_target on follows (followed_type, followed_id);

alter table follows enable row level security;

create policy follows_select_own on follows
  for select to authenticated
  using (follower_profile_id = private.current_profile_id());

create policy follows_insert_own on follows
  for insert to authenticated
  with check (follower_profile_id = private.current_profile_id());

create policy follows_delete_own on follows
  for delete to authenticated
  using (follower_profile_id = private.current_profile_id());


-- =============================================================================
-- 3. FOOTBALL ENTITIES (schema-only — lean on purpose, no provider live yet)
-- =============================================================================

create table venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  city        text,
  country     text,
  capacity    integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint venues_capacity_non_negative check (capacity is null or capacity >= 0)
);

create trigger trg_venues_updated_at before update on venues
  for each row execute function set_updated_at();


create table competitions (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  short_name  text,
  country     text, -- null = international competition
  logo_url    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_competitions_updated_at before update on competitions
  for each row execute function set_updated_at();


create table seasons (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references competitions (id) on delete cascade,
  name            text not null, -- e.g. "2025/2026"
  start_date      date,
  end_date        date,
  is_current      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint seasons_unique_name unique (competition_id, name),
  constraint seasons_date_order check (start_date is null or end_date is null or start_date <= end_date)
);

create trigger trg_seasons_updated_at before update on seasons
  for each row execute function set_updated_at();

create index idx_seasons_competition_id on seasons (competition_id);
-- Enforces "at most one current season per competition" without a trigger.
create unique index idx_seasons_one_current_per_competition on seasons (competition_id) where is_current;


create table teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  short_name    text,
  country       text,
  founded_year  smallint,
  crest_url     text,
  venue_id      uuid references venues (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint teams_founded_year_range check (founded_year is null or founded_year between 1800 and 2100)
);

create trigger trg_teams_updated_at before update on teams
  for each row execute function set_updated_at();

create index idx_teams_venue_id on teams (venue_id);
create index idx_teams_name on teams (name);

-- Deferred FK: teams didn't exist yet when `profiles` was created above.
alter table profiles
  add constraint profiles_favourite_team_id_fkey
  foreign key (favourite_team_id) references teams (id) on delete set null;


create table players (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  known_as         text,
  date_of_birth    date,
  nationality      text,
  position         text, -- free text on purpose: real position taxonomies vary a lot per provider
  current_team_id  uuid references teams (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_players_updated_at before update on players
  for each row execute function set_updated_at();

create index idx_players_current_team_id on players (current_team_id);
create index idx_players_full_name on players (full_name);


create table managers (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  nationality      text,
  date_of_birth    date,
  current_team_id  uuid references teams (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger trg_managers_updated_at before update on managers
  for each row execute function set_updated_at();

create index idx_managers_current_team_id on managers (current_team_id);


create table fixtures (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references competitions (id) on delete restrict,
  season_id       uuid not null references seasons (id) on delete restrict,
  home_team_id    uuid not null references teams (id) on delete restrict,
  away_team_id    uuid not null references teams (id) on delete restrict,
  venue_id        uuid references venues (id) on delete set null,
  status          fixture_status not null default 'scheduled',
  kickoff_at      timestamptz not null,
  matchday        smallint, -- round/gameweek number within the competition, provider-agnostic
  home_score      smallint,
  away_score      smallint,
  home_score_ht   smallint,
  away_score_ht   smallint,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint fixtures_distinct_teams check (home_team_id <> away_team_id),
  constraint fixtures_scores_non_negative check (
    (home_score is null or home_score >= 0) and (away_score is null or away_score >= 0)
    and (home_score_ht is null or home_score_ht >= 0) and (away_score_ht is null or away_score_ht >= 0)
  )
);

create trigger trg_fixtures_updated_at before update on fixtures
  for each row execute function set_updated_at();

create index idx_fixtures_competition_season on fixtures (competition_id, season_id);
create index idx_fixtures_kickoff_at on fixtures (kickoff_at);
create index idx_fixtures_status on fixtures (status);
create index idx_fixtures_home_team_id on fixtures (home_team_id);
create index idx_fixtures_away_team_id on fixtures (away_team_id);


create table fixture_events (
  id                 uuid primary key default gen_random_uuid(),
  fixture_id         uuid not null references fixtures (id) on delete cascade,
  team_id            uuid not null references teams (id) on delete restrict,
  player_id          uuid references players (id) on delete set null,
  related_player_id  uuid references players (id) on delete set null, -- e.g. sub coming on, assist provider
  event_type         fixture_event_type not null,
  minute             smallint not null,
  added_time         smallint,
  detail             text,
  created_at         timestamptz not null default now(),
  constraint fixture_events_minute_range check (minute between 0 and 130)
);

create index idx_fixture_events_fixture_id on fixture_events (fixture_id, minute);


create table lineups (
  id             uuid primary key default gen_random_uuid(),
  fixture_id     uuid not null references fixtures (id) on delete cascade,
  team_id        uuid not null references teams (id) on delete restrict,
  player_id      uuid not null references players (id) on delete restrict,
  is_starting    boolean not null default true,
  shirt_number   smallint,
  position       text,
  created_at     timestamptz not null default now(),
  constraint lineups_unique_player_per_fixture unique (fixture_id, team_id, player_id)
);

create index idx_lineups_fixture_team on lineups (fixture_id, team_id);


create table standings (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons (id) on delete cascade,
  team_id      uuid not null references teams (id) on delete restrict,
  played       integer not null default 0,
  won          integer not null default 0,
  drawn        integer not null default 0,
  lost         integer not null default 0,
  goals_for    integer not null default 0,
  goals_against integer not null default 0,
  points       integer not null default 0,
  position     smallint,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint standings_unique_team_per_season unique (season_id, team_id)
);

create trigger trg_standings_updated_at before update on standings
  for each row execute function set_updated_at();

create index idx_standings_season_id on standings (season_id);

-- Football reference data: readable by everyone (including logged-out
-- visitors browsing fixtures/standings), writable only by the football data
-- pipeline's admin role or platform admins. No data-ingestion RLS bypass is
-- assumed here — a future sync job should use the service_role key.
do $$
declare
  t text;
begin
  foreach t in array array[
    'venues', 'competitions', 'seasons', 'teams', 'players', 'managers',
    'fixtures', 'fixture_events', 'lineups', 'standings'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for select to authenticated, anon using (true)',
      t || '_select_public', t
    );
    execute format(
      'create policy %I on %I for insert to authenticated with check (private.has_role(array[''football_data_admin'', ''admin'', ''super_admin'']))',
      t || '_insert_admin', t
    );
    execute format(
      'create policy %I on %I for update to authenticated using (private.has_role(array[''football_data_admin'', ''admin'', ''super_admin''])) with check (private.has_role(array[''football_data_admin'', ''admin'', ''super_admin'']))',
      t || '_update_admin', t
    );
    execute format(
      'create policy %I on %I for delete to authenticated using (private.has_role(array[''football_data_admin'', ''admin'', ''super_admin'']))',
      t || '_delete_admin', t
    );
  end loop;
end $$;


-- =============================================================================
-- 4. PROVIDER INFRASTRUCTURE
-- =============================================================================

create table provider_mappings (
  id                uuid primary key default gen_random_uuid(),
  entity_type       provider_entity_type not null,
  kivo_entity_id    uuid not null, -- polymorphic: id in whichever table entity_type names
  provider          text not null, -- e.g. 'opta', 'sportmonks', 'api-football'
  provider_entity_id text not null,
  extra             jsonb not null default '{}'::jsonb, -- genuinely provider-specific fields only
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint provider_mappings_unique_provider_entity unique (provider, entity_type, provider_entity_id),
  constraint provider_mappings_unique_kivo_entity unique (provider, entity_type, kivo_entity_id)
);

create trigger trg_provider_mappings_updated_at before update on provider_mappings
  for each row execute function set_updated_at();

create index idx_provider_mappings_entity on provider_mappings (entity_type, kivo_entity_id);

alter table provider_mappings enable row level security;

create policy provider_mappings_all_admin on provider_mappings
  for all to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


create table sync_runs (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,
  entity_type        provider_entity_type not null,
  status             sync_status not null default 'running',
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  last_synced_at     timestamptz,
  records_processed  integer,
  error_message      text,
  created_at         timestamptz not null default now()
);

create index idx_sync_runs_provider_entity on sync_runs (provider, entity_type, started_at desc);

alter table sync_runs enable row level security;

create policy sync_runs_all_admin on sync_runs
  for all to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


-- =============================================================================
-- 5. SOCIAL
-- =============================================================================

-- Shared by posts/comments moderation and the reports queue: broader than
-- just "admin" since moderator/content_admin/support_admin all triage here.
create or replace function private.can_moderate()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.has_role(array['moderator', 'admin', 'super_admin', 'content_admin', 'support_admin']);
$$;

create table posts (
  id                uuid primary key default gen_random_uuid(),
  author_profile_id uuid not null references profiles (id) on delete cascade,
  fixture_id        uuid references fixtures (id) on delete set null, -- set => match-room post
  body              text not null,
  is_edited         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint posts_body_length check (char_length(body) between 1 and 2000)
);

create trigger trg_posts_updated_at before update on posts
  for each row execute function set_updated_at();

create index idx_posts_fixture_id on posts (fixture_id);
create index idx_posts_author_profile_id on posts (author_profile_id);
create index idx_posts_created_at on posts (created_at desc);

alter table posts enable row level security;

create policy posts_select_public on posts
  for select to authenticated, anon
  using (true);

create policy posts_insert_own on posts
  for insert to authenticated
  with check (author_profile_id = private.current_profile_id());

create policy posts_update_own on posts
  for update to authenticated
  using (author_profile_id = private.current_profile_id())
  with check (author_profile_id = private.current_profile_id());

create policy posts_delete_own_or_moderator on posts
  for delete to authenticated
  using (author_profile_id = private.current_profile_id() or private.can_moderate());


create table comments (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references posts (id) on delete cascade,
  author_profile_id   uuid not null references profiles (id) on delete cascade,
  parent_comment_id   uuid references comments (id) on delete cascade,
  body                text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint comments_body_length check (char_length(body) between 1 and 1000)
);

create trigger trg_comments_updated_at before update on comments
  for each row execute function set_updated_at();

create index idx_comments_post_id on comments (post_id);
create index idx_comments_parent_comment_id on comments (parent_comment_id);

alter table comments enable row level security;

create policy comments_select_public on comments
  for select to authenticated, anon
  using (true);

create policy comments_insert_own on comments
  for insert to authenticated
  with check (author_profile_id = private.current_profile_id());

create policy comments_update_own on comments
  for update to authenticated
  using (author_profile_id = private.current_profile_id())
  with check (author_profile_id = private.current_profile_id());

create policy comments_delete_own_or_moderator on comments
  for delete to authenticated
  using (author_profile_id = private.current_profile_id() or private.can_moderate());


create table reactions (
  id            uuid primary key default gen_random_uuid(),
  target_type   reaction_target_type not null,
  target_id     uuid not null, -- polymorphic: posts(id) or comments(id) depending on target_type
  profile_id    uuid not null references profiles (id) on delete cascade,
  reaction_type reaction_type not null,
  created_at    timestamptz not null default now(),
  -- One reaction per user per target (changing reaction = delete + insert,
  -- not an update-in-place); keeps "did I react to this" a single lookup.
  constraint reactions_unique_per_target unique (target_type, target_id, profile_id)
);

create index idx_reactions_target on reactions (target_type, target_id);

alter table reactions enable row level security;

create policy reactions_select_public on reactions
  for select to authenticated, anon
  using (true);

create policy reactions_insert_own on reactions
  for insert to authenticated
  with check (profile_id = private.current_profile_id());

create policy reactions_delete_own on reactions
  for delete to authenticated
  using (profile_id = private.current_profile_id());


create table reports (
  id                     uuid primary key default gen_random_uuid(),
  reporter_profile_id    uuid not null references profiles (id) on delete cascade,
  target_type            moderation_target_type not null,
  target_id              uuid not null, -- polymorphic: posts/comments/profiles(id) depending on target_type
  reason                 text not null,
  status                 report_status not null default 'pending',
  resolved_by_profile_id uuid references profiles (id) on delete set null,
  resolved_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint reports_reason_length check (char_length(reason) between 1 and 1000)
);

create trigger trg_reports_updated_at before update on reports
  for each row execute function set_updated_at();

create index idx_reports_status on reports (status);
create index idx_reports_target on reports (target_type, target_id);

alter table reports enable row level security;

create policy reports_select_own_or_moderator on reports
  for select to authenticated
  using (reporter_profile_id = private.current_profile_id() or private.can_moderate());

create policy reports_insert_own on reports
  for insert to authenticated
  with check (reporter_profile_id = private.current_profile_id());

-- Only moderators progress a report's status/resolution; the reporter's own
-- insert right doesn't extend to editing it afterwards.
create policy reports_update_moderator on reports
  for update to authenticated
  using (private.can_moderate())
  with check (private.can_moderate());


create table moderation_actions (
  id                uuid primary key default gen_random_uuid(),
  admin_profile_id  uuid references profiles (id) on delete set null, -- nullable: preserve audit history if the actor's profile is later removed
  action            text not null,
  target_type       moderation_target_type not null,
  target_id         uuid not null,
  reason            text,
  report_id         uuid references reports (id) on delete set null,
  created_at        timestamptz not null default now()
  -- no updated_at: audit rows are append-only and never edited in place
);

create index idx_moderation_actions_target on moderation_actions (target_type, target_id);
create index idx_moderation_actions_admin on moderation_actions (admin_profile_id);

alter table moderation_actions enable row level security;

create policy moderation_actions_select_moderator on moderation_actions
  for select to authenticated
  using (private.can_moderate());

create policy moderation_actions_insert_moderator on moderation_actions
  for insert to authenticated
  with check (private.can_moderate() and admin_profile_id = private.current_profile_id());

-- Intentionally no update/delete policy anywhere: this is the audit trail,
-- it must stay append-only even to admins acting through the API.


-- =============================================================================
-- 6. PREDICTIONS & REWARDS
-- =============================================================================

create table predictions (
  id                uuid primary key default gen_random_uuid(),
  profile_id        uuid not null references profiles (id) on delete cascade,
  fixture_id        uuid not null references fixtures (id) on delete cascade,
  predicted_outcome prediction_outcome not null,
  points_awarded    smallint,
  locked_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint predictions_unique_per_fixture unique (profile_id, fixture_id)
);

create trigger trg_predictions_updated_at before update on predictions
  for each row execute function set_updated_at();

create index idx_predictions_fixture_id on predictions (fixture_id);
create index idx_predictions_profile_id on predictions (profile_id);

alter table predictions enable row level security;

create policy predictions_select_own on predictions
  for select to authenticated
  using (profile_id = private.current_profile_id());

create policy predictions_insert_own on predictions
  for insert to authenticated
  with check (profile_id = private.current_profile_id());

-- Once locked_at is set the row drops out of the USING clause entirely, so
-- a user can no longer change a prediction after lock — enforced in RLS
-- itself rather than relying on the client to respect it.
create policy predictions_update_own_unlocked on predictions
  for update to authenticated
  using (profile_id = private.current_profile_id() and locked_at is null)
  with check (profile_id = private.current_profile_id());

create policy predictions_delete_own_unlocked on predictions
  for delete to authenticated
  using (profile_id = private.current_profile_id() and locked_at is null);


create table xp_ledger (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  amount      integer not null,
  reason      text not null,
  created_at  timestamptz not null default now(),
  constraint xp_ledger_amount_nonzero check (amount <> 0)
);

create index idx_xp_ledger_profile_id on xp_ledger (profile_id, created_at desc);

alter table xp_ledger enable row level security;

create policy xp_ledger_select_own on xp_ledger
  for select to authenticated
  using (profile_id = private.current_profile_id());

-- No insert/update/delete policy for authenticated: XP is a trust-sensitive
-- ledger and must only be written by trusted server-side logic using the
-- service_role key (which bypasses RLS entirely), never directly by a client.


create table badges (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique, -- stable machine key, e.g. 'first_prediction'
  name         text not null,
  description  text,
  icon_url     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_badges_updated_at before update on badges
  for each row execute function set_updated_at();

alter table badges enable row level security;

create policy badges_select_public on badges
  for select to authenticated, anon
  using (true);

create policy badges_write_admin on badges
  for all to authenticated
  using (private.has_role(array['admin', 'super_admin', 'content_admin']))
  with check (private.has_role(array['admin', 'super_admin', 'content_admin']));


create table user_badges (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  badge_id    uuid not null references badges (id) on delete cascade,
  awarded_at  timestamptz not null default now(),
  constraint user_badges_unique unique (profile_id, badge_id)
);

alter table user_badges enable row level security;

create policy user_badges_select_own on user_badges
  for select to authenticated
  using (profile_id = private.current_profile_id());

-- No client insert/update/delete: badges are awarded by trusted server-side
-- logic (service_role), same rationale as xp_ledger.


-- =============================================================================
-- 7. FANTASY
-- =============================================================================

create table fantasy_leagues (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  creator_profile_id uuid not null references profiles (id) on delete cascade,
  season_id          uuid not null references seasons (id) on delete restrict,
  is_private         boolean not null default true,
  invite_code        text unique,
  max_teams          smallint not null default 20,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fantasy_leagues_max_teams_positive check (max_teams > 0)
);

create trigger trg_fantasy_leagues_updated_at before update on fantasy_leagues
  for each row execute function set_updated_at();

create index idx_fantasy_leagues_season_id on fantasy_leagues (season_id);

alter table fantasy_leagues enable row level security;

-- Owner-only per the prompt's "fantasy_teams/etc are owner-only" rule.
-- Joining a private league by invite code therefore should not require a
-- base-table SELECT for non-members — implement that as a SECURITY DEFINER
-- RPC (redeem_invite_code(text)) later rather than widening this policy.
create policy fantasy_leagues_all_own on fantasy_leagues
  for all to authenticated
  using (creator_profile_id = private.current_profile_id())
  with check (creator_profile_id = private.current_profile_id());


create table fantasy_teams (
  id                 uuid primary key default gen_random_uuid(),
  owner_profile_id   uuid not null references profiles (id) on delete cascade,
  league_id          uuid not null references fantasy_leagues (id) on delete cascade,
  name               text not null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fantasy_teams_unique_owner_per_league unique (league_id, owner_profile_id)
);

create trigger trg_fantasy_teams_updated_at before update on fantasy_teams
  for each row execute function set_updated_at();

create index idx_fantasy_teams_league_id on fantasy_teams (league_id);

alter table fantasy_teams enable row level security;

create policy fantasy_teams_all_own on fantasy_teams
  for all to authenticated
  using (owner_profile_id = private.current_profile_id())
  with check (owner_profile_id = private.current_profile_id());


create table fantasy_gameweeks (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid not null references seasons (id) on delete cascade,
  number       smallint not null,
  deadline_at  timestamptz not null,
  is_current   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fantasy_gameweeks_unique_number unique (season_id, number),
  constraint fantasy_gameweeks_number_positive check (number > 0)
);

create trigger trg_fantasy_gameweeks_updated_at before update on fantasy_gameweeks
  for each row execute function set_updated_at();

create unique index idx_fantasy_gameweeks_one_current_per_season on fantasy_gameweeks (season_id) where is_current;

alter table fantasy_gameweeks enable row level security;

-- Schedule/deadline data, not user data — public read is what makes
-- deadlines useful (every participant needs to see them, not just owners).
create policy fantasy_gameweeks_select_public on fantasy_gameweeks
  for select to authenticated, anon
  using (true);

create policy fantasy_gameweeks_write_admin on fantasy_gameweeks
  for all to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));


create table fantasy_rosters (
  id               uuid primary key default gen_random_uuid(),
  fantasy_team_id  uuid not null references fantasy_teams (id) on delete cascade,
  gameweek_id      uuid not null references fantasy_gameweeks (id) on delete cascade,
  player_id        uuid not null references players (id) on delete cascade,
  is_starting      boolean not null default true,
  is_captain       boolean not null default false,
  is_vice_captain  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fantasy_rosters_unique_slot unique (fantasy_team_id, gameweek_id, player_id),
  constraint fantasy_rosters_captain_xor_vice check (not (is_captain and is_vice_captain))
);

create trigger trg_fantasy_rosters_updated_at before update on fantasy_rosters
  for each row execute function set_updated_at();

create index idx_fantasy_rosters_team_gameweek on fantasy_rosters (fantasy_team_id, gameweek_id);

alter table fantasy_rosters enable row level security;

-- Owner-only via the parent fantasy_teams row, including hiding a squad
-- from league rivals — a deliberately conservative default; a "reveal after
-- deadline" view can be layered on top later without changing this table.
create policy fantasy_rosters_all_own on fantasy_rosters
  for all to authenticated
  using (exists (
    select 1 from fantasy_teams t
    where t.id = fantasy_rosters.fantasy_team_id and t.owner_profile_id = private.current_profile_id()
  ))
  with check (exists (
    select 1 from fantasy_teams t
    where t.id = fantasy_rosters.fantasy_team_id and t.owner_profile_id = private.current_profile_id()
  ));


create table fantasy_points (
  id               uuid primary key default gen_random_uuid(),
  fantasy_team_id  uuid not null references fantasy_teams (id) on delete cascade,
  gameweek_id      uuid not null references fantasy_gameweeks (id) on delete cascade,
  points           integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fantasy_points_unique_team_gameweek unique (fantasy_team_id, gameweek_id)
);

create trigger trg_fantasy_points_updated_at before update on fantasy_points
  for each row execute function set_updated_at();

alter table fantasy_points enable row level security;

create policy fantasy_points_select_own on fantasy_points
  for select to authenticated
  using (exists (
    select 1 from fantasy_teams t
    where t.id = fantasy_points.fantasy_team_id and t.owner_profile_id = private.current_profile_id()
  ));

-- No client write policy: points are computed by the scoring job
-- (service_role), same rationale as xp_ledger.


-- =============================================================================
-- 8. NOTIFICATIONS
-- =============================================================================

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  type        text not null, -- free text, not enum: notification types will grow continuously as features ship
  payload     jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index idx_notifications_profile_created on notifications (profile_id, created_at desc);
create index idx_notifications_unread on notifications (profile_id) where read_at is null;

alter table notifications enable row level security;

create policy notifications_select_own on notifications
  for select to authenticated
  using (profile_id = private.current_profile_id());

-- Client is only ever expected to flip read_at; nothing stops it updating
-- other columns via this policy today (RLS is row-scoped, not column-scoped)
-- — acceptable since a user mutating their own notification's payload/type
-- has no security impact beyond their own view, but flagged for awareness.
create policy notifications_update_own on notifications
  for update to authenticated
  using (profile_id = private.current_profile_id())
  with check (profile_id = private.current_profile_id());

-- No insert/delete for authenticated: notifications are system-generated
-- (service_role) only.


create table notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references notifications (id) on delete cascade,
  channel             delivery_channel not null,
  status               delivery_status not null default 'pending',
  provider             text, -- e.g. 'fcm', 'resend', 'twilio'
  provider_message_id text,
  sent_at              timestamptz,
  failed_reason        text,
  created_at           timestamptz not null default now()
);

create index idx_notification_deliveries_notification_id on notification_deliveries (notification_id);

alter table notification_deliveries enable row level security;

create policy notification_deliveries_select_own on notification_deliveries
  for select to authenticated
  using (exists (
    select 1 from notifications n
    where n.id = notification_deliveries.notification_id and n.profile_id = private.current_profile_id()
  ));

-- No client writes: delivery records are written by the sending
-- infrastructure (service_role) only.


-- =============================================================================
-- 9. AI
-- =============================================================================

create table ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_ai_conversations_updated_at before update on ai_conversations
  for each row execute function set_updated_at();

create index idx_ai_conversations_profile_id on ai_conversations (profile_id, created_at desc);

alter table ai_conversations enable row level security;

create policy ai_conversations_all_own on ai_conversations
  for all to authenticated
  using (profile_id = private.current_profile_id())
  with check (profile_id = private.current_profile_id());


create table ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references ai_conversations (id) on delete cascade,
  role             ai_message_role not null,
  content          text not null,
  created_at       timestamptz not null default now()
);

create index idx_ai_messages_conversation_id on ai_messages (conversation_id, created_at);

alter table ai_messages enable row level security;

-- Owner-only via the parent conversation. Full CRUD (unlike xp_ledger/
-- notifications) because this is the user's own chat data, not a
-- trust-sensitive system ledger — a malicious edit only affects their own
-- conversation history.
create policy ai_messages_all_own on ai_messages
  for all to authenticated
  using (exists (
    select 1 from ai_conversations c
    where c.id = ai_messages.conversation_id and c.profile_id = private.current_profile_id()
  ))
  with check (exists (
    select 1 from ai_conversations c
    where c.id = ai_messages.conversation_id and c.profile_id = private.current_profile_id()
  ));


-- =============================================================================
-- 10. ADMIN / AUDIT
-- =============================================================================

create table audit_log (
  id                uuid primary key default gen_random_uuid(),
  actor_profile_id  uuid references profiles (id) on delete set null, -- nullable: system-initiated actions, and to preserve history if the actor is later removed
  action            text not null,
  target_type       text not null, -- intentionally free text: this is the general-purpose sensitive-action log spanning every domain above, an enum here would need editing on every new admin surface
  target_id         uuid,
  reason            text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index idx_audit_log_actor on audit_log (actor_profile_id);
create index idx_audit_log_target on audit_log (target_type, target_id);
create index idx_audit_log_created_at on audit_log (created_at desc);

alter table audit_log enable row level security;

create policy audit_log_select_admin on audit_log
  for select to authenticated
  using (private.is_admin());

create policy audit_log_insert_admin on audit_log
  for insert to authenticated
  with check (private.is_admin() and (actor_profile_id = private.current_profile_id() or actor_profile_id is null));

-- No update/delete policy: audit_log is append-only, including for admins
-- acting through the API — corrections are new rows, not edits, by design.
