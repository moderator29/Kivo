-- =============================================================================
-- Fix: 0092's rename triggers fired too early to record anything
-- =============================================================================
-- 0092 attached `private.record_rename_alias()` BEFORE UPDATE, reasoning that
-- the old name is what needs capturing and would be gone afterwards. That is
-- true of `NEW`, and irrelevant: `OLD` is available in an AFTER trigger too.
--
-- What the reasoning missed is the interaction with `record_entity_alias`
-- (0090), which deliberately refuses an alias equal to the entity's CURRENT
-- name — because recording a club's own name as an alias of itself would make
-- every search match it twice. Inside a BEFORE trigger the row in the table is
-- still the old row, so `teams.name` still reads as the old name, so the old
-- name is the current name, so every single write was refused. The trigger
-- fired correctly, called the right function with the right arguments, and
-- recorded nothing, with no error anywhere.
--
-- Found by running it against the real database rather than by reading it: a
-- rename followed by a count asserted one alias row and got zero. It is worth
-- naming the class of bug, because nothing about the code looks wrong — two
-- individually correct guards that only conflict when composed.
--
-- AFTER UPDATE has OLD in the trigger record while the table already holds the
-- new name, which is the only point at which both halves are true.

drop trigger if exists trg_teams_record_rename_alias on teams;
create trigger trg_teams_record_rename_alias
  after update of name, short_name on teams
  for each row execute function private.record_rename_alias();

drop trigger if exists trg_players_record_rename_alias on players;
create trigger trg_players_record_rename_alias
  after update of full_name, known_as on players
  for each row execute function private.record_rename_alias();

-- Verified live after applying, on a throwaway team that was then deleted:
-- a rename records exactly one alias; an unrelated column update records none;
-- the old name still resolves through resolve_football_entities; the row
-- carries source = 'rename'; renaming back and forth settles at two aliases
-- rather than growing; and deleting the team removes its aliases.

-- To reverse: recreate both triggers as BEFORE UPDATE, which restores the
-- silent no-op 0092 shipped with.
