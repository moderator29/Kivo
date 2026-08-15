-- RECOMMENDATIONS.md items 53 and 57.
--
-- 57: NormalizedFixture.minute is fetched from API-Football on every fixture
-- request but had no column to land in, so the Live page could never show
-- "67'" on a live match. Add fixtures.minute_elapsed and thread it through
-- upsert_fixture_with_mapping the same way home_score/away_score already are.
--
-- 53: API-Football returns its own x-ratelimit-requests-remaining header on
-- every response, but ApiFootballProvider.request() discarded it. Add
-- sync_runs.provider_quota_remaining so a sync run can record the real
-- remaining-quota count Data Health can then show instead of an estimate.

alter table fixtures add column minute_elapsed smallint;

alter table fixtures add constraint fixtures_minute_elapsed_non_negative
  check (minute_elapsed is null or minute_elapsed >= 0);

alter table sync_runs add column provider_quota_remaining integer;

alter table sync_runs add constraint sync_runs_quota_remaining_non_negative
  check (provider_quota_remaining is null or provider_quota_remaining >= 0);

-- Extend upsert_fixture_with_mapping (migration 0018) with three new optional
-- args. The old 11-arg signature is dropped explicitly first rather than
-- relying on create-or-replace to widen it in place — PostgREST resolves an
-- rpc() call by matching argument names against a specific overload, and
-- leaving both the old and new signature registered risks an "operation is
-- not unique" ambiguity error the moment a caller omits one of the new
-- optional args (which every existing caller does, until sync.ts is updated
-- in the same deploy).
drop function if exists public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint
);

create function public.upsert_fixture_with_mapping(
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
  p_away_score smallint default null,
  p_home_score_ht smallint default null,
  p_away_score_ht smallint default null,
  p_minute_elapsed smallint default null
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
        away_score = p_away_score,
        home_score_ht = p_home_score_ht,
        away_score_ht = p_away_score_ht,
        minute_elapsed = p_minute_elapsed
    where id = v_id;
    return v_id;
  end if;

  insert into fixtures (
    competition_id, season_id, home_team_id, away_team_id, venue_id,
    status, kickoff_at, home_score, away_score, home_score_ht, away_score_ht, minute_elapsed
  )
  values (
    p_competition_id, p_season_id, p_home_team_id, p_away_team_id, p_venue_id,
    p_status, p_kickoff_at, p_home_score, p_away_score, p_home_score_ht, p_away_score_ht, p_minute_elapsed
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

-- The old 11-arg signature is gone (dropped above), so grants must be applied
-- fresh against the new 14-arg signature.
revoke execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint, smallint, smallint, smallint
) from public;
revoke execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint, smallint, smallint, smallint
) from anon, authenticated;
grant execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint, smallint, smallint, smallint
) to service_role;

-- To reverse: drop function public.upsert_fixture_with_mapping(text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz, uuid, smallint, smallint, smallint, smallint, smallint);
-- (recreate the 11-arg version from migration 0018 to fully roll back), then
-- alter table sync_runs drop column provider_quota_remaining;
-- alter table fixtures drop column minute_elapsed;
