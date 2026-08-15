-- Real per-team match statistics (API-Football's /fixtures/statistics endpoint).
-- No "average rating" or "tackles" columns — those are Sofascore-proprietary
-- metrics API-Football's free tier doesn't expose; only fields the provider
-- actually returns are modeled here.
create table fixture_statistics (
  id                 uuid primary key default gen_random_uuid(),
  fixture_id         uuid not null references fixtures (id) on delete cascade,
  team_id            uuid not null references teams (id) on delete restrict,
  shots_total        smallint,
  shots_on_target    smallint,
  shots_off_target   smallint,
  shots_blocked      smallint,
  shots_inside_box   smallint,
  shots_outside_box  smallint,
  fouls              smallint,
  corners            smallint,
  offsides           smallint,
  possession_pct     smallint,
  yellow_cards       smallint,
  red_cards          smallint,
  saves              smallint,
  passes_total       smallint,
  passes_accurate    smallint,
  passes_pct         smallint,
  -- Only some competitions/providers report xG — stays null rather than 0 when unknown.
  expected_goals     numeric(4, 2),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fixture_statistics_unique_team_per_fixture unique (fixture_id, team_id),
  constraint fixture_statistics_possession_range check (possession_pct is null or possession_pct between 0 and 100),
  constraint fixture_statistics_passes_pct_range check (passes_pct is null or passes_pct between 0 and 100)
);

create trigger trg_fixture_statistics_updated_at before update on fixture_statistics
  for each row execute function set_updated_at();

create index idx_fixture_statistics_fixture_id on fixture_statistics (fixture_id);

-- Same public-read / admin-write shape as the other football reference tables
-- (see the `do $$ ... foreach t in array [...]` block in 0001_kivo_core_schema.sql).
alter table fixture_statistics enable row level security;

create policy fixture_statistics_select_public on fixture_statistics
  for select to authenticated, anon
  using (true);

create policy fixture_statistics_insert_admin on fixture_statistics
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

create policy fixture_statistics_update_admin on fixture_statistics
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

create policy fixture_statistics_delete_admin on fixture_statistics
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
