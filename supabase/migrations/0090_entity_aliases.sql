-- =============================================================================
-- team_aliases and player_aliases — the other names a club or a player has
-- =============================================================================
-- The founding brief names three tables KIVO does not have: `data_conflicts`,
-- `team_aliases` and `player_aliases`. Two of them are genuinely missing and
-- are built here.
--
-- `data_conflicts` is NOT built, and that is a finding rather than a gap. It
-- already exists under a different name: `data_anomalies` (migration 0056),
-- whose own comment reads "Persisted record of a data conflict the pipeline
-- detected", and which carries every column such a table would need — the two
-- values that disagreed, the provider, the entity, the sync run, and a review
-- workflow. A second table would split one concept across two places and give
-- the admin queue two lists to read. See DECISIONS.md.
--
-- What that audit did surface is a real hole, and it is fixed alongside this:
-- `data_anomaly_type` has a `provider_disagreement` value, the admin panel has
-- a label for it, and nothing in the codebase ever wrote one. That producer is
-- in src/lib/football/sync.ts.
--
-- WHY ALIASES ARE WORTH A TABLE. Provider ids are how KIVO identifies an
-- entity, and that is right — names are not identifiers. But names are how
-- *people* identify one, and they vary: "Man Utd" and "Manchester United",
-- "Enyimba FC" and "Enyimba International", a club that renamed in 2019, and
-- the losing name every time an admin merges two duplicate rows. Without a
-- place to record them, each of those is either an unfindable search or a
-- second duplicate row waiting to be created.
--
-- WHAT AN ALIAS IS NOT. It is not a guess. Every row here has a `source` that
-- says where the name came from — a provider sent it, a merge retired it, or
-- an admin typed it — and nothing infers an alias from string similarity. A
-- fuzzy match is how aliases are *used*, never how they are created.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'entity_alias_source') then
    -- Three real provenances, and no 'inferred'. If KIVO ever guesses a name,
    -- that guess does not get to look like a recorded fact.
    create type entity_alias_source as enum ('provider', 'merge', 'admin');
  end if;
end
$$;

create table if not exists team_aliases (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams (id) on delete cascade,
  alias      text not null,
  source     entity_alias_source not null,
  /** The provider that used this name, when a provider is where it came from. */
  provider   text,
  /** Free-text provenance for a human — e.g. "former name, renamed 2019".
   * Never generated, so an empty note means nobody wrote one. */
  note       text,
  created_at timestamptz not null default now(),
  constraint team_aliases_alias_length check (char_length(btrim(alias)) between 2 and 120),
  -- A provider alias must name its provider, and a non-provider alias must not
  -- invent one. Encoded rather than trusted, because provenance is the whole
  -- reason this column exists.
  constraint team_aliases_provider_consistent check ((source = 'provider') = (provider is not null))
);

create table if not exists player_aliases (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references players (id) on delete cascade,
  alias      text not null,
  source     entity_alias_source not null,
  provider   text,
  note       text,
  created_at timestamptz not null default now(),
  constraint player_aliases_alias_length check (char_length(btrim(alias)) between 2 and 120),
  constraint player_aliases_provider_consistent check ((source = 'provider') = (provider is not null))
);

-- Case- and whitespace-insensitive uniqueness PER ENTITY. Deliberately not
-- globally unique: "Arsenal" is a real name for more than one football club,
-- and a global constraint would make recording the second one an error rather
-- than the true statement it is. Ambiguity is handled where aliases are read
-- — see the resolver below, which returns both and lets the caller see the
-- collision instead of silently picking one.
create unique index if not exists idx_team_aliases_unique
  on team_aliases (team_id, lower(btrim(alias)));
create unique index if not exists idx_player_aliases_unique
  on player_aliases (player_id, lower(btrim(alias)));

create index if not exists idx_team_aliases_team on team_aliases (team_id);
create index if not exists idx_player_aliases_player on player_aliases (player_id);

-- Trigram indexes, matching the ones migration 0021 created on teams.name and
-- players.full_name, so alias matching reads an index rather than scanning.
-- pg_trgm lives in the `extensions` schema (migration 0026 moved it there).
create index if not exists idx_team_aliases_alias_trgm
  on team_aliases using gin (alias extensions.gin_trgm_ops);
create index if not exists idx_player_aliases_alias_trgm
  on player_aliases using gin (alias extensions.gin_trgm_ops);

-- Same public-read / admin-write shape as every other football reference
-- table (see the `do $$ ... foreach t in array [...]` block in 0001). An alias
-- is reference data about a club, not a user's private row.
alter table team_aliases enable row level security;
alter table player_aliases enable row level security;

drop policy if exists team_aliases_select_public on team_aliases;
create policy team_aliases_select_public on team_aliases
  for select to authenticated using (true);

drop policy if exists team_aliases_write_admin on team_aliases;
create policy team_aliases_write_admin on team_aliases
  for all to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

drop policy if exists player_aliases_select_public on player_aliases;
create policy player_aliases_select_public on player_aliases
  for select to authenticated using (true);

drop policy if exists player_aliases_write_admin on player_aliases;
create policy player_aliases_write_admin on player_aliases
  for all to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- -----------------------------------------------------------------------------
-- Recording one
-- -----------------------------------------------------------------------------
-- One entry point, so the sync path and the merge path cannot drift into
-- writing different shapes. Idempotent, and it refuses two things outright:
-- an alias identical to the entity's own current name (that is the name, not
-- an alias, and recording it would make every search match twice), and a blank.
create or replace function public.record_entity_alias(
  p_entity_type provider_entity_type,
  p_entity_id   uuid,
  p_alias       text,
  p_source      entity_alias_source,
  p_provider    text default null,
  p_note        text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_alias text := btrim(coalesce(p_alias, ''));
  v_written boolean := false;
begin
  if char_length(v_alias) < 2 then
    return false;
  end if;

  if p_entity_type = 'team' then
    -- Not an alias if it is already the club's name or short name.
    if exists (
      select 1 from teams t
      where t.id = p_entity_id
        and (lower(btrim(t.name)) = lower(v_alias) or lower(btrim(coalesce(t.short_name, ''))) = lower(v_alias))
    ) then
      return false;
    end if;

    insert into team_aliases (team_id, alias, source, provider, note)
    values (p_entity_id, v_alias, p_source, p_provider, p_note)
    on conflict do nothing;
    get diagnostics v_written = row_count;
    return v_written;

  elsif p_entity_type = 'player' then
    if exists (
      select 1 from players pl
      where pl.id = p_entity_id
        and (lower(btrim(pl.full_name)) = lower(v_alias) or lower(btrim(coalesce(pl.known_as, ''))) = lower(v_alias))
    ) then
      return false;
    end if;

    insert into player_aliases (player_id, alias, source, provider, note)
    values (p_entity_id, v_alias, p_source, p_provider, p_note)
    on conflict do nothing;
    get diagnostics v_written = row_count;
    return v_written;
  end if;

  -- Only teams and players have alias tables. Anything else is a caller bug
  -- rather than a silent no-op.
  raise exception 'record_entity_alias supports team and player only, got %', p_entity_type
    using errcode = '22023';
end;
$$;

revoke execute on function public.record_entity_alias(provider_entity_type, uuid, text, entity_alias_source, text, text) from public;
revoke execute on function public.record_entity_alias(provider_entity_type, uuid, text, entity_alias_source, text, text) from anon;
revoke execute on function public.record_entity_alias(provider_entity_type, uuid, text, entity_alias_source, text, text) from authenticated;
grant execute on function public.record_entity_alias(provider_entity_type, uuid, text, entity_alias_source, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- A merge retires a name. Keep it.
-- -----------------------------------------------------------------------------
-- `merge_teams` (0076) repoints every foreign key and then deletes the merged
-- row — correct, and it means the name people had been searching for stops
-- resolving to anything the moment an admin tidies up. The merged row is not
-- lost (entity_merges.merged_snapshot holds it), so the name is recoverable;
-- it simply was not being recovered.
--
-- A trigger on `entity_merges` rather than an edit to `merge_teams`: the merge
-- function is long, careful and already correct, and rewriting it in full to
-- add two inserts would risk far more than it gains. This also covers any
-- future entity type that learns to merge, and it fires inside the merge's own
-- transaction, so an alias never exists for a merge that rolled back.
create or replace function private.record_merge_alias()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_short text;
begin
  if new.entity_type = 'team' then
    v_name  := new.merged_snapshot ->> 'name';
    v_short := new.merged_snapshot ->> 'short_name';
    if v_name is not null then
      perform public.record_entity_alias(
        'team', new.survivor_id, v_name, 'merge', null,
        'Name of a duplicate team row merged into this one'
      );
    end if;
    if v_short is not null then
      perform public.record_entity_alias(
        'team', new.survivor_id, v_short, 'merge', null,
        'Short name of a duplicate team row merged into this one'
      );
    end if;
  elsif new.entity_type = 'player' then
    v_name := new.merged_snapshot ->> 'full_name';
    if v_name is not null then
      perform public.record_entity_alias(
        'player', new.survivor_id, v_name, 'merge', null,
        'Name of a duplicate player row merged into this one'
      );
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.record_merge_alias() from public;

drop trigger if exists trg_entity_merges_record_alias on entity_merges;
create trigger trg_entity_merges_record_alias after insert on entity_merges
  for each row execute function private.record_merge_alias();

-- Backfill from merges that already happened. Idempotent by construction —
-- record_entity_alias does nothing on conflict — so re-running is safe.
do $$
declare
  r record;
begin
  for r in select * from entity_merges loop
    if r.entity_type = 'team' then
      perform public.record_entity_alias(
        'team', r.survivor_id, r.merged_snapshot ->> 'name', 'merge', null,
        'Name of a duplicate team row merged into this one'
      );
    elsif r.entity_type = 'player' then
      perform public.record_entity_alias(
        'player', r.survivor_id, r.merged_snapshot ->> 'full_name', 'merge', null,
        'Name of a duplicate player row merged into this one'
      );
    end if;
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Using them
-- -----------------------------------------------------------------------------
-- `resolve_football_entities` (0067) matches a phrase against real names via
-- pg_trgm. This adds aliases as an additional match source, with the entity's
-- own canonical name still what gets returned as the label — somebody typing
-- "Man Utd" should find the club and see it called what it is actually called.
--
-- Same signature, so `create or replace` keeps the existing grants; they are
-- restated below anyway, because a recreated function on this project has
-- silently lost its grants before.
--
-- An alias match scores the same way a name match does. It is deliberately not
-- discounted: "Man Utd" is not a worse identification of Manchester United
-- than "Manchester Unite" is, and inventing a penalty term would be exactly
-- the kind of unexplainable weighting this codebase avoids.
create or replace function public.resolve_football_entities(
  p_phrases        text[],
  p_limit          int  default 6,
  p_min_similarity real default 0.4
)
returns table (
  entity_type text,
  entity_id   uuid,
  label       text,
  sublabel    text,
  score       real
)
language sql
set search_path = public, extensions, pg_temp
stable
as $$
  with phrases as (
    select distinct lower(btrim(p)) as phrase
    from unnest(p_phrases) as p
    where length(btrim(p)) >= 3
  ),
  matched as (
    select
      'team'::text as entity_type,
      t.id         as entity_id,
      t.name       as label,
      t.country    as sublabel,
      max(similarity(t.name, ph.phrase)) as score
    from teams t
    join phrases ph on t.name % ph.phrase
    group by t.id, t.name, t.country

    union all

    -- Aliases. The label is still the club's real name.
    select
      'team'::text,
      t.id,
      t.name,
      t.country,
      max(similarity(ta.alias, ph.phrase))
    from team_aliases ta
    join teams t on t.id = ta.team_id
    join phrases ph on ta.alias % ph.phrase
    group by t.id, t.name, t.country

    union all

    select
      'player'::text,
      pl.id,
      coalesce(pl.known_as, pl.full_name),
      pl.position,
      max(greatest(similarity(pl.full_name, ph.phrase), similarity(coalesce(pl.known_as, ''), ph.phrase)))
    from players pl
    join phrases ph on (pl.full_name % ph.phrase or pl.known_as % ph.phrase)
    group by pl.id, pl.known_as, pl.full_name, pl.position

    union all

    select
      'player'::text,
      pl.id,
      coalesce(pl.known_as, pl.full_name),
      pl.position,
      max(similarity(pa.alias, ph.phrase))
    from player_aliases pa
    join players pl on pl.id = pa.player_id
    join phrases ph on pa.alias % ph.phrase
    group by pl.id, pl.known_as, pl.full_name, pl.position

    union all

    select
      'competition'::text,
      c.id,
      c.name,
      c.country,
      max(similarity(c.name, ph.phrase))
    from competitions c
    join phrases ph on c.name % ph.phrase
    group by c.id, c.name, c.country
  )
  -- One entity can now match twice — once on its name and once on an alias.
  -- The better of the two is what it is worth, and it appears once.
  select entity_type, entity_id, max(label) as label, max(sublabel) as sublabel, max(score) as score
  from matched
  group by entity_type, entity_id
  having max(score) >= p_min_similarity
  order by max(score) desc, max(label) asc
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.resolve_football_entities(text[], int, real) from public;
revoke execute on function public.resolve_football_entities(text[], int, real) from anon;
grant execute on function public.resolve_football_entities(text[], int, real) to authenticated;

-- To reverse:
--   (restore resolve_football_entities from 0067)
--   drop trigger if exists trg_entity_merges_record_alias on entity_merges;
--   drop function if exists private.record_merge_alias();
--   drop function if exists public.record_entity_alias(provider_entity_type, uuid, text, entity_alias_source, text, text);
--   drop table if exists player_aliases;
--   drop table if exists team_aliases;
--   drop type if exists entity_alias_source;
