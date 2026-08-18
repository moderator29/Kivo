-- =============================================================================
-- KN-83: an admin entity-merge tool for teams
-- =============================================================================
-- `provider_mappings` keys on (provider, entity_type, provider_entity_id), so
-- switching data provider creates a second, disconnected universe: the same
-- real club existing twice, with no link, and every fixture, table row and
-- follow split between the two. `docs/PROVIDER_ABSTRACTION.md` and
-- RECOMMENDATIONS item 298 both treat reconciling two providers' ids as a
-- separate, larger feature — and the item is right that the cheap first step is
-- not failover, it is a merge, because a merge is also what item 255's
-- duplicate-detection panel would feed once it exists. Build the merge before
-- the detection.
--
-- ## This is the most destructive thing in this schema, so:
--
-- **Dry run by default.** `p_dry_run` defaults to true. Called without
-- arguments beyond the two ids, this changes nothing and returns a full report
-- of what it *would* do — including what would block it. An admin sees the
-- consequences before authorising them.
--
-- **It refuses rather than improvises.** Three situations abort the merge with
-- a named reason instead of being resolved by guesswork:
--
--   1. A fixture where one of these teams is home and the other is away.
--      Merging would make a club play itself, which `fixtures_distinct_teams`
--      forbids and which means these two rows are probably *not* the same club.
--      That is a signal to stop, not an obstacle to route around.
--   2. Both teams already mapped to the same provider. The unique constraint
--      `provider_mappings_unique_kivo_entity` permits one provider id per
--      entity, so keeping both is impossible — and silently dropping one would
--      destroy the pipeline's ability to dedupe future syncs arriving under
--      that id. A human needs to decide which id is real.
--   3. Either id not being a team at all, or the two being the same row.
--
-- **Everything else is one transaction**, and every row it moves or deletes is
-- counted into an `entity_merges` record — which is the founding brief's
-- "audited manual data corrections" being genuinely auditable rather than a
-- line in a log.
--
-- ## What "merge" means for rows that collide
--
-- Several tables have unique keys that include `team_id`. Repointing can
-- therefore collide with a row the survivor already has. In every such case the
-- **survivor's row wins and the loser's is deleted**, and the count is
-- reported. That is the correct reading: the survivor is the club KIVO is
-- keeping, and two rows describing the same club's same standing/statistic are
-- duplicates by definition — but the count is surfaced so an admin can see how
-- much was genuinely redundant versus how much they are about to lose.

create table if not exists entity_merges (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        provider_entity_type not null,
  survivor_id        uuid not null,
  merged_id          uuid not null,
  merged_snapshot    jsonb not null,
  moved_counts       jsonb not null,
  performed_by       uuid references profiles (id) on delete set null,
  performed_at       timestamptz not null default now(),
  constraint entity_merges_distinct check (survivor_id <> merged_id)
);

comment on table entity_merges is
  'Audit record of an admin entity merge (KN-83). `merged_snapshot` is the full row that was removed, so a merge can be described (and the removed entity re-created) after the fact; `moved_counts` records how many rows were repointed and how many were deleted as duplicates, per table.';

create index if not exists idx_entity_merges_survivor on entity_merges (entity_type, survivor_id);

alter table entity_merges enable row level security;

create policy entity_merges_select_admin on entity_merges
  for select to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- No client write policy: written only by the merge function below.


create or replace function public.merge_teams(
  p_survivor_id uuid,
  p_merged_id uuid,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_survivor teams%rowtype;
  v_merged teams%rowtype;
  v_blockers text[] := '{}';
  v_head_to_head integer;
  v_shared_provider text;
  v_counts jsonb := '{}'::jsonb;
  v_moved integer;
  v_deleted integer;
begin
  v_actor := private.current_profile_id();
  if not private.has_role(array['football_data_admin', 'admin', 'super_admin']) then
    raise exception 'You do not have permission to merge football entities.';
  end if;

  if p_survivor_id = p_merged_id then
    raise exception 'Cannot merge a team into itself.';
  end if;

  select * into v_survivor from teams where id = p_survivor_id;
  if not found then raise exception 'Survivor team % does not exist.', p_survivor_id; end if;
  select * into v_merged from teams where id = p_merged_id;
  if not found then raise exception 'Team to merge % does not exist.', p_merged_id; end if;

  -- Blocker 1: a fixture between the two. If these are the same club, this
  -- fixture cannot exist; if it exists, they are probably not the same club.
  select count(*) into v_head_to_head from fixtures
   where (home_team_id = p_survivor_id and away_team_id = p_merged_id)
      or (home_team_id = p_merged_id and away_team_id = p_survivor_id);
  if v_head_to_head > 0 then
    v_blockers := v_blockers || format(
      '%s fixture(s) have these two teams playing each other — merging would make a club play itself, which usually means these are not the same club.',
      v_head_to_head);
  end if;

  -- Blocker 2: both mapped to the same provider.
  select pm_a.provider into v_shared_provider
  from provider_mappings pm_a
  join provider_mappings pm_b
    on pm_b.provider = pm_a.provider and pm_b.entity_type = pm_a.entity_type
  where pm_a.entity_type = 'team'
    and pm_a.kivo_entity_id = p_survivor_id
    and pm_b.kivo_entity_id = p_merged_id
  limit 1;
  if v_shared_provider is not null then
    v_blockers := v_blockers || format(
      'Both teams are already mapped to provider "%s". Only one provider id per entity is allowed, and dropping one would break dedup for future syncs arriving under it — decide which id is real first.',
      v_shared_provider);
  end if;

  if array_length(v_blockers, 1) > 0 then
    return jsonb_build_object(
      'ok', false,
      'dry_run', p_dry_run,
      'survivor', to_jsonb(v_survivor),
      'merged', to_jsonb(v_merged),
      'blockers', to_jsonb(v_blockers)
    );
  end if;

  -- ---------------------------------------------------------------------
  -- Counts. In a dry run these are the *predicted* effect; in a real run the
  -- same numbers are what actually happened, because each block counts what
  -- it just did.
  -- ---------------------------------------------------------------------
  if p_dry_run then
    v_counts := jsonb_build_object(
      'fixtures_home', (select count(*) from fixtures where home_team_id = p_merged_id),
      'fixtures_away', (select count(*) from fixtures where away_team_id = p_merged_id),
      'lineups', (select count(*) from lineups where team_id = p_merged_id),
      'fixture_events', (select count(*) from fixture_events where team_id = p_merged_id),
      'fixture_statistics', (select count(*) from fixture_statistics where team_id = p_merged_id),
      'standings', (select count(*) from standings where team_id = p_merged_id),
      'standings_snapshots', (select count(*) from standings_snapshots where team_id = p_merged_id),
      'players', (select count(*) from players where current_team_id = p_merged_id),
      'managers', (select count(*) from managers where current_team_id = p_merged_id),
      'transfers_from', (select count(*) from transfers where from_team_id = p_merged_id),
      'transfers_to', (select count(*) from transfers where to_team_id = p_merged_id),
      'favourite_of_profiles', (select count(*) from profiles where favourite_team_id = p_merged_id),
      'follows', (select count(*) from follows where followed_type = 'team' and followed_id = p_merged_id),
      'provider_mappings', (select count(*) from provider_mappings where entity_type = 'team' and kivo_entity_id = p_merged_id),
      'standings_duplicates_to_delete', (
        select count(*) from standings s_merged
        where s_merged.team_id = p_merged_id
          and exists (select 1 from standings s_keep
                      where s_keep.team_id = p_survivor_id and s_keep.season_id = s_merged.season_id)
      )
    );

    return jsonb_build_object(
      'ok', true,
      'dry_run', true,
      'survivor', to_jsonb(v_survivor),
      'merged', to_jsonb(v_merged),
      'blockers', '[]'::jsonb,
      'would_move', v_counts
    );
  end if;

  -- ---------------------------------------------------------------------
  -- Real merge. Order matters: delete colliding rows before repointing, so a
  -- unique constraint never fires mid-way and abort the whole thing.
  -- ---------------------------------------------------------------------

  -- standings: one row per (season, team). The survivor's wins.
  delete from standings s_merged
   where s_merged.team_id = p_merged_id
     and exists (select 1 from standings s_keep
                 where s_keep.team_id = p_survivor_id and s_keep.season_id = s_merged.season_id);
  get diagnostics v_deleted = row_count;
  update standings set team_id = p_survivor_id where team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('standings_moved', v_moved, 'standings_deleted_duplicate', v_deleted);

  -- follows: one row per (follower, type, target). Somebody following both
  -- clubs ends up following the survivor once, not twice.
  delete from follows f_merged
   where f_merged.followed_type = 'team' and f_merged.followed_id = p_merged_id
     and exists (select 1 from follows f_keep
                 where f_keep.follower_profile_id = f_merged.follower_profile_id
                   and f_keep.followed_type = 'team' and f_keep.followed_id = p_survivor_id);
  get diagnostics v_deleted = row_count;
  update follows set followed_id = p_survivor_id
   where followed_type = 'team' and followed_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('follows_moved', v_moved, 'follows_deleted_duplicate', v_deleted);

  -- fixture_events: the natural key (migration 0056) includes team_id, so
  -- repointing can collide with an identical event already on the survivor.
  delete from fixture_events e_merged
   where e_merged.team_id = p_merged_id
     and exists (
       select 1 from fixture_events e_keep
       where e_keep.team_id = p_survivor_id
         and e_keep.fixture_id = e_merged.fixture_id
         and e_keep.event_type = e_merged.event_type
         and e_keep.minute = e_merged.minute
         and coalesce(e_keep.added_time, -1) = coalesce(e_merged.added_time, -1)
         and e_keep.player_id is not distinct from e_merged.player_id
         and e_keep.related_player_id is not distinct from e_merged.related_player_id
     );
  get diagnostics v_deleted = row_count;
  update fixture_events set team_id = p_survivor_id where team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('fixture_events_moved', v_moved, 'fixture_events_deleted_duplicate', v_deleted);

  -- lineups: unique on (fixture, team, player).
  delete from lineups l_merged
   where l_merged.team_id = p_merged_id
     and exists (select 1 from lineups l_keep
                 where l_keep.team_id = p_survivor_id
                   and l_keep.fixture_id = l_merged.fixture_id
                   and l_keep.player_id = l_merged.player_id);
  get diagnostics v_deleted = row_count;
  update lineups set team_id = p_survivor_id where team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('lineups_moved', v_moved, 'lineups_deleted_duplicate', v_deleted);

  -- fixture_statistics: one row per (fixture, team).
  delete from fixture_statistics fs_merged
   where fs_merged.team_id = p_merged_id
     and exists (select 1 from fixture_statistics fs_keep
                 where fs_keep.team_id = p_survivor_id and fs_keep.fixture_id = fs_merged.fixture_id);
  get diagnostics v_deleted = row_count;
  update fixture_statistics set team_id = p_survivor_id where team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('fixture_statistics_moved', v_moved, 'fixture_statistics_deleted_duplicate', v_deleted);

  -- Straight repoints — no unique key involving team_id to collide with.
  update fixtures set home_team_id = p_survivor_id where home_team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('fixtures_home_moved', v_moved);

  update fixtures set away_team_id = p_survivor_id where away_team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('fixtures_away_moved', v_moved);

  update standings_snapshots set team_id = p_survivor_id where team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('standings_snapshots_moved', v_moved);

  update players set current_team_id = p_survivor_id where current_team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('players_moved', v_moved);

  update managers set current_team_id = p_survivor_id where current_team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('managers_moved', v_moved);

  update transfers set from_team_id = p_survivor_id where from_team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('transfers_from_moved', v_moved);

  update transfers set to_team_id = p_survivor_id where to_team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('transfers_to_moved', v_moved);

  update profiles set favourite_team_id = p_survivor_id where favourite_team_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('favourite_of_profiles_moved', v_moved);

  -- `saves` is polymorphic (target_type/target_id) with a unique key per
  -- (profile, type, target), so it needs the same collision handling.
  delete from saves s_merged
   where s_merged.target_type = 'team' and s_merged.target_id = p_merged_id
     and exists (select 1 from saves s_keep
                 where s_keep.profile_id = s_merged.profile_id
                   and s_keep.target_type = 'team' and s_keep.target_id = p_survivor_id);
  get diagnostics v_deleted = row_count;
  update saves set target_id = p_survivor_id where target_type = 'team' and target_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('saves_moved', v_moved, 'saves_deleted_duplicate', v_deleted);

  -- The point of the whole exercise: BOTH provider identities now resolve to
  -- one KIVO club, so a sync from either provider lands on the same rows. This
  -- is safe here precisely because the same-provider case was refused above.
  update provider_mappings set kivo_entity_id = p_survivor_id
   where entity_type = 'team' and kivo_entity_id = p_merged_id;
  get diagnostics v_moved = row_count;
  v_counts := v_counts || jsonb_build_object('provider_mappings_moved', v_moved);

  insert into entity_merges (entity_type, survivor_id, merged_id, merged_snapshot, moved_counts, performed_by)
  values ('team', p_survivor_id, p_merged_id, to_jsonb(v_merged), v_counts, v_actor);

  delete from teams where id = p_merged_id;

  return jsonb_build_object(
    'ok', true,
    'dry_run', false,
    'survivor', to_jsonb(v_survivor),
    'merged', to_jsonb(v_merged),
    'blockers', '[]'::jsonb,
    'moved', v_counts
  );
end;
$$;

revoke execute on function public.merge_teams(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.merge_teams(uuid, uuid, boolean) to service_role;

comment on function public.merge_teams(uuid, uuid, boolean) is
  'Merges one team row into another (KN-83), repointing every foreign key and both provider mappings. Dry run by default. Refuses rather than improvising when the two teams have played each other, when both are mapped to the same provider, or when either id is not a team. Every real run writes an entity_merges audit row containing the removed row and per-table counts. Service-role only; the admin role check inside is what gates the calling action.';


-- To reverse:
--   drop function if exists public.merge_teams(uuid, uuid, boolean);
--   drop table if exists entity_merges;
-- Note that reversing the *effect* of a merge that has already run is not
-- something a migration can do: `entity_merges.merged_snapshot` holds the row
-- that was removed, but the repointed foreign keys are indistinguishable from
-- rows that always belonged to the survivor. That asymmetry is exactly why the
-- dry run exists and is the default.
