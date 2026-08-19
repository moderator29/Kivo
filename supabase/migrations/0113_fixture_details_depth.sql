-- =============================================================================
-- The three facts a match page needs and KIVO was throwing away
-- =============================================================================
-- The founder asked for the Match Centre to have the depth a fan expects from
-- a real football product, naming Sofascore's Details tab as the reference.
-- Comparing what that tab shows against what KIVO holds, three of its lines
-- were missing — and not because the provider withholds them. Every one of
-- them arrives on the SAME `/fixtures` payload KIVO already fetches and pays
-- for, and the adapter dropped all three on the floor:
--
--   * `fixture.referee`   — not even declared on the response interface.
--   * `league.round`      — declared, but only `parseMatchday` ran over it. That
--                           extracts a NUMBER ("Regular Season - 12" → 12) and
--                           correctly returns null for "Quarter-finals". So for
--                           every cup tie, the one string that names the round
--                           was parsed, found to contain no number, and
--                           discarded. A knockout fixture could not say which
--                           round it was.
--   * `venue.city`        — the column has existed since migration 0001 and
--                           nothing ever wrote to it from a fixture sync.
--
-- This costs ZERO additional provider requests. It is the same response, read
-- more completely.
--
-- -----------------------------------------------------------------------------
-- `round_label` is text, and it is not a parsed number
-- -----------------------------------------------------------------------------
-- `fixtures.matchday` already holds the number where there is one, and it stays
-- exactly as it is. This is the provider's own label, stored verbatim, because
-- the label is the fact for a competition that has no numbered matchday:
-- "Quarter-finals", "Group Stage - 2", "Round of 16". Parsing it further would
-- be inventing structure the provider did not supply, and the last time this
-- codebase turned a label into a number it had to be documented at length that
-- "Round of 16" is not matchday 16.
--
-- So the two columns answer two different questions and neither replaces the
-- other: `matchday` sorts a league season, `round_label` names a cup round.
--
-- -----------------------------------------------------------------------------
-- Never clobber with null, everywhere
-- -----------------------------------------------------------------------------
-- All three follow the rule the rest of this schema already applies to crests,
-- photos and matchday: a provider response that omits a field must not erase a
-- value an earlier sync legitimately established. A live-score refresh carries
-- less detail than a daily sync, and a referee's name disappearing every time
-- the score updated would be a bug that only ever showed up during a match.

alter table fixtures add column if not exists referee text;
alter table fixtures add column if not exists round_label text;

comment on column fixtures.referee is
  'The match official, exactly as the provider reports the name. Null means the provider did not supply one — never an assertion that a fixture has no referee.';

comment on column fixtures.round_label is
  'The provider''s own round label, verbatim ("Quarter-finals", "Regular Season - 12"). Distinct from `matchday`, which is the parsed number and is null for any round that has none. Neither replaces the other.';

-- -----------------------------------------------------------------------------
-- The fixture upsert gains two parameters
-- -----------------------------------------------------------------------------
-- DESTRUCTIVE and deliberately so, for exactly the reason migration 0072 spells
-- out when it did this same thing: adding a parameter does NOT replace a
-- function. Postgres treats the new arity as a distinct overload, so a bare
-- `create or replace` leaves the old 15-argument version standing beside the
-- new 17-argument one, and a call that omits the optional arguments then
-- matches both candidates and fails with "function ... is not unique".
--
-- Risk assessment, same as 0072's: the only caller anywhere is `upsertFixture`
-- in src/lib/football/sync.ts, updated in this same change. The new form is a
-- strict superset with defaulted parameters, so no caller loses a capability.
-- Guarded by IF EXISTS, so re-applying is safe.
drop function if exists public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz,
  uuid, smallint, smallint, smallint, smallint, smallint, smallint
);

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
  p_away_score smallint default null,
  p_home_score_ht smallint default null,
  p_away_score_ht smallint default null,
  p_minute_elapsed smallint default null,
  p_matchday smallint default null,
  p_referee text default null,
  p_round_label text default null
)
returns uuid
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
        minute_elapsed = p_minute_elapsed,
        matchday = coalesce(p_matchday, fixtures.matchday),
        -- Same never-overwrite-with-null rule. A live-score refresh carries
        -- less than a daily sync; a referee that vanished mid-match would be
        -- the most confusing possible way for that to show.
        referee = coalesce(p_referee, fixtures.referee),
        round_label = coalesce(p_round_label, fixtures.round_label)
    where id = v_id;
    return v_id;
  end if;

  insert into fixtures (
    competition_id, season_id, home_team_id, away_team_id, venue_id,
    status, kickoff_at, home_score, away_score, home_score_ht, away_score_ht,
    minute_elapsed, matchday, referee, round_label
  )
  values (
    p_competition_id, p_season_id, p_home_team_id, p_away_team_id, p_venue_id,
    p_status, p_kickoff_at, p_home_score, p_away_score, p_home_score_ht, p_away_score_ht,
    p_minute_elapsed, p_matchday, p_referee, p_round_label
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
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz,
  uuid, smallint, smallint, smallint, smallint, smallint, smallint, text, text
) from public, anon, authenticated;

grant execute on function public.upsert_fixture_with_mapping(
  text, text, uuid, uuid, uuid, uuid, fixture_status, timestamptz,
  uuid, smallint, smallint, smallint, smallint, smallint, smallint, text, text
) to service_role;

-- -----------------------------------------------------------------------------
-- The venue upsert gains a city
-- -----------------------------------------------------------------------------
-- Also fixes a latent crash while it is here. The old body ran
-- `insert into venues (name) values (p_name)` on the new-venue path, and
-- `venues.name` is NOT NULL — so a provider that reported a venue id with no
-- name (which the response type explicitly permits: `name: string | null`) would
-- raise a not-null violation and fail the whole fixture. It has not fired
-- because API-Football has always sent a name alongside an id, which is luck
-- rather than a guarantee. A venue KIVO knows the id of but not the name is now
-- recorded as "Unknown venue" and corrected by the next sync that carries one.
drop function if exists public.upsert_venue_with_mapping(text, text, text);

create or replace function public.upsert_venue_with_mapping(
  p_provider text,
  p_provider_entity_id text,
  p_name text default null,
  p_city text default null
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
    update venues
    set name = coalesce(p_name, venues.name),
        city = coalesce(p_city, venues.city)
    where id = v_id;
    return v_id;
  end if;

  insert into venues (name, city) values (coalesce(p_name, 'Unknown venue'), p_city) returning id into v_id;

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

revoke execute on function public.upsert_venue_with_mapping(text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_venue_with_mapping(text, text, text, text) to service_role;

-- To reverse:
--   (recreate the 15-arg fixture and 3-arg venue functions from 0072/0018)
--   alter table fixtures drop column if exists round_label;
--   alter table fixtures drop column if exists referee;
