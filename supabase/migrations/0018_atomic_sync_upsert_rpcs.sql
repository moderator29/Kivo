-- Item 22 (RECOMMENDATIONS.md): sync.ts's upsertCompetition/upsertTeam/upsertVenue/
-- upsertFixture each did a client-side "insert the entity row, then insert its
-- provider_mappings row" as two separate round trips. If the second insert ever
-- failed (network blip, a future RLS/permission change, anything), the first
-- insert had already committed — an orphan entity row with no mapping, which the
-- next sync duplicates because findMappedId() looks up by mapping, finds nothing,
-- and inserts a second entity row for the same provider id.
--
-- Postgres functions are implicitly transactional: everything a single function
-- call does either all commits or all rolls back. Wrapping "insert/update the
-- entity, insert its mapping" in one SECURITY DEFINER function per entity makes
-- the pairing atomic without touching the tables' existing RLS policies (writes
-- still only ever come from sync.ts's service-role client, same as before — see
-- 0001's "a future sync job should use the service_role key" comment on the
-- football-entity tables' RLS block, and provider_mappings_all_admin above it).
--
-- Each function reproduces its TS counterpart's exact behavior:
--   * competitions/teams: update on every sync (never return early on a hit).
--   * venues/teams: "never clobber a real value with a later null" for the
--     provider-optional columns (venue name; team short_name/crest_url).
--   * fixtures: update-in-place when already mapped, insert-plus-map otherwise.
-- Each also keeps the old "23505 on the mapping insert = a concurrent sync won
-- the race, fine" handling from createMapping() in sync.ts — but goes one step
-- further than the old client-side version could: because the entity insert and
-- the mapping insert now share one transaction, the loser can detect the race
-- *before* committing and delete its own just-inserted entity row instead of
-- leaving it behind as exactly the kind of unmapped orphan this migration exists
-- to stop creating. The old code couldn't do this — by the time createMapping()
-- saw the 23505, the entity insert had already committed on its own connection.
--
-- Every nullable column's parameter carries `default null`: PostgREST calls
-- Postgres functions with named arguments, so a parameter with a default can be
-- omitted from the call entirely — which is exactly what the generated
-- supabase-js Args type does with it (`p_name?: string`, never `string | null`,
-- since Postgres has no not-null concept for a plain function argument). The
-- TypeScript call sites in sync.ts lean on that: they only set the key when
-- they actually have a non-null value, and omit it otherwise, which is
-- equivalent to explicitly passing null but satisfies the generated type.

create or replace function public.upsert_competition_with_mapping(
  p_provider text,
  p_provider_entity_id text,
  p_name text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select kivo_entity_id into v_id
  from provider_mappings
  where provider = p_provider and entity_type = 'competition' and provider_entity_id = p_provider_entity_id;

  if found then
    update competitions set name = p_name where id = v_id;
    return v_id;
  end if;

  insert into competitions (name) values (p_name) returning id into v_id;

  begin
    insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
    values (p_provider, 'competition', p_provider_entity_id, v_id);
  exception when unique_violation then
    delete from competitions where id = v_id;
    select kivo_entity_id into v_id
    from provider_mappings
    where provider = p_provider and entity_type = 'competition' and provider_entity_id = p_provider_entity_id;
  end;

  return v_id;
end;
$$;

revoke execute on function public.upsert_competition_with_mapping(text, text, text) from public;
revoke execute on function public.upsert_competition_with_mapping(text, text, text) from anon, authenticated;
grant execute on function public.upsert_competition_with_mapping(text, text, text) to service_role;


-- name stays nullable (0017) — a provider id with no reported name stays
-- honestly unnamed rather than backfilled with a fabricated placeholder, and an
-- update never overwrites a real name with a later null.
create or replace function public.upsert_venue_with_mapping(
  p_provider text,
  p_provider_entity_id text,
  p_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select kivo_entity_id into v_id
  from provider_mappings
  where provider = p_provider and entity_type = 'venue' and provider_entity_id = p_provider_entity_id;

  if found then
    if p_name is not null then
      update venues set name = p_name where id = v_id;
    end if;
    return v_id;
  end if;

  insert into venues (name) values (p_name) returning id into v_id;

  begin
    insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
    values (p_provider, 'venue', p_provider_entity_id, v_id);
  exception when unique_violation then
    delete from venues where id = v_id;
    select kivo_entity_id into v_id
    from provider_mappings
    where provider = p_provider and entity_type = 'venue' and provider_entity_id = p_provider_entity_id;
  end;

  return v_id;
end;
$$;

revoke execute on function public.upsert_venue_with_mapping(text, text, text) from public;
revoke execute on function public.upsert_venue_with_mapping(text, text, text) from anon, authenticated;
grant execute on function public.upsert_venue_with_mapping(text, text, text) to service_role;


-- name updates on every sync (always provided by the provider). short_name and
-- crest_url only overwrite when this sync's payload actually carries a
-- non-null value, so a crest an admin filled in by hand never gets nulled out
-- by a leaner provider response.
create or replace function public.upsert_team_with_mapping(
  p_provider text,
  p_provider_entity_id text,
  p_name text,
  p_short_name text default null,
  p_crest_url text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select kivo_entity_id into v_id
  from provider_mappings
  where provider = p_provider and entity_type = 'team' and provider_entity_id = p_provider_entity_id;

  if found then
    update teams
    set name = p_name,
        short_name = coalesce(p_short_name, short_name),
        crest_url = coalesce(p_crest_url, crest_url)
    where id = v_id;
    return v_id;
  end if;

  insert into teams (name, short_name, crest_url)
  values (p_name, p_short_name, p_crest_url)
  returning id into v_id;

  begin
    insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
    values (p_provider, 'team', p_provider_entity_id, v_id);
  exception when unique_violation then
    delete from teams where id = v_id;
    select kivo_entity_id into v_id
    from provider_mappings
    where provider = p_provider and entity_type = 'team' and provider_entity_id = p_provider_entity_id;
  end;

  return v_id;
end;
$$;

revoke execute on function public.upsert_team_with_mapping(text, text, text, text, text) from public;
revoke execute on function public.upsert_team_with_mapping(text, text, text, text, text) from anon, authenticated;
grant execute on function public.upsert_team_with_mapping(text, text, text, text, text) to service_role;


-- Same update-in-place-when-mapped / insert-plus-map-otherwise shape as
-- upsertFixture in sync.ts. Every column here is written unconditionally on
-- update (unlike venues/teams above) because the fixture sync always has a
-- fresh, complete payload for every column from the provider on every run —
-- there is no "provider omitted this field this time" case to guard against
-- for the columns that aren't already nullable in the schema. venue_id,
-- home_score and away_score are nullable in `fixtures` itself (an unplayed
-- fixture has no score yet, some fixtures have no venue) and so come last
-- with `default null` — Postgres requires defaulted parameters to trail, which
-- is why this parameter order doesn't match the table's own column order.
create or replace function public.upsert_fixture_with_mapping(
  p_provider text,
  p_provider_entity_id text,
  p_competition_id uuid,
  p_season_id uuid,
  p_home_team_id uuid,
  p_away_team_id uuid,
  p_status fixture_status,
  p_kickoff_at timestamptz,
  p_venue_id uuid default null,
  p_home_score smallint default null,
  p_away_score smallint default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select kivo_entity_id into v_id
  from provider_mappings
  where provider = p_provider and entity_type = 'fixture' and provider_entity_id = p_provider_entity_id;

  if found then
    update fixtures
    set competition_id = p_competition_id,
        season_id = p_season_id,
        home_team_id = p_home_team_id,
        away_team_id = p_away_team_id,
        venue_id = p_venue_id,
        status = p_status,
        kickoff_at = p_kickoff_at,
        home_score = p_home_score,
        away_score = p_away_score
    where id = v_id;
    return v_id;
  end if;

  insert into fixtures (
    competition_id, season_id, home_team_id, away_team_id, venue_id,
    status, kickoff_at, home_score, away_score
  )
  values (
    p_competition_id, p_season_id, p_home_team_id, p_away_team_id, p_venue_id,
    p_status, p_kickoff_at, p_home_score, p_away_score
  )
  returning id into v_id;

  begin
    insert into provider_mappings (provider, entity_type, provider_entity_id, kivo_entity_id)
    values (p_provider, 'fixture', p_provider_entity_id, v_id);
  exception when unique_violation then
    delete from fixtures where id = v_id;
    select kivo_entity_id into v_id
    from provider_mappings
    where provider = p_provider and entity_type = 'fixture' and provider_entity_id = p_provider_entity_id;
  end;

  return v_id;
end;
$$;

revoke execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint
) from public;
revoke execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint
) from anon, authenticated;
grant execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint
) to service_role;

-- sync-squads.ts's upsertPlayer/upsertManager have the identical insert-plus-
-- mapping shape and the identical orphan-row risk, but are deliberately left
-- out of this migration: they're admin-triggered per-team (never part of the
-- hundreds-of-fixtures-per-run loop in syncTodayFixtures), so the blast radius
-- of a failed mapping insert is one player/manager row per run, not a whole
-- fixture sync. Item 22 itself only calls out sync.ts. Same RPC pattern can be
-- lifted into sync-squads.ts in a follow-up if that risk turns out to matter
-- in practice.

-- To reverse: drop function public.upsert_competition_with_mapping(text, text, text);
-- drop function public.upsert_venue_with_mapping(text, text, text);
-- drop function public.upsert_team_with_mapping(text, text, text, text, text);
-- drop function public.upsert_fixture_with_mapping(text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint);
