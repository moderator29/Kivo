-- =============================================================================
-- The trigger half of 0091: capture a name at the moment it is replaced
-- =============================================================================
-- Separate from 0091 only because Postgres refuses to use a newly added enum
-- label inside the transaction that added it. See that migration's note.
--
-- BEFORE UPDATE, and it writes the OLD name — which is the entire point, and
-- the reason this cannot be done AFTER: by then the old name is gone.
--
-- NOTE: this reasoning is WRONG, and 0093 corrects it. Kept exactly as applied
-- so the migration files and the applied history stay identical — the same
-- convention 0033, 0058 and 0063 already follow on this project.
--
-- Guarded on the name actually changing (`is distinct from`), so the ordinary
-- sync path — which updates crest urls and short names constantly and the name
-- almost never — pays nothing. `record_entity_alias` is itself idempotent and
-- refuses a value equal to the entity's current name, so a name that flips back
-- and forth between two spellings settles into two alias rows rather than
-- growing forever.

create or replace function private.record_rename_alias()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'teams' then
    if new.name is distinct from old.name then
      perform public.record_entity_alias(
        'team', new.id, old.name, 'rename', null,
        'Previous name, kept when the club was renamed'
      );
    end if;
    -- A short name is a real name people search by ("Man Utd"), so it is worth
    -- the same treatment. Null short names are skipped by record_entity_alias's
    -- own length check rather than by a condition here.
    if new.short_name is distinct from old.short_name then
      perform public.record_entity_alias(
        'team', new.id, old.short_name, 'rename', null,
        'Previous short name, kept when the club was renamed'
      );
    end if;
  elsif tg_table_name = 'players' then
    if new.full_name is distinct from old.full_name then
      perform public.record_entity_alias(
        'player', new.id, old.full_name, 'rename', null,
        'Previous name, kept when the player record was renamed'
      );
    end if;
    if new.known_as is distinct from old.known_as then
      perform public.record_entity_alias(
        'player', new.id, old.known_as, 'rename', null,
        'Previous known-as name, kept when the player record was renamed'
      );
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.record_rename_alias() from public;

drop trigger if exists trg_teams_record_rename_alias on teams;
create trigger trg_teams_record_rename_alias
  before update of name, short_name on teams
  for each row execute function private.record_rename_alias();

drop trigger if exists trg_players_record_rename_alias on players;
create trigger trg_players_record_rename_alias
  before update of full_name, known_as on players
  for each row execute function private.record_rename_alias();

-- To reverse:
--   drop trigger if exists trg_players_record_rename_alias on players;
--   drop trigger if exists trg_teams_record_rename_alias on teams;
--   drop function if exists private.record_rename_alias();
