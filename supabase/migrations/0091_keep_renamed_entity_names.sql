-- =============================================================================
-- A rename should not delete the old name
-- =============================================================================
-- 0090 built `team_aliases` and `player_aliases` and gave them one automatic
-- producer: an admin merge, which retires the losing row's name. This adds the
-- other one, and it is the one that will actually fill the tables.
--
-- Every football sync overwrites `teams.name` with whatever the provider sent
-- (see upsertTeam in src/lib/football/sync.ts). That is correct — the provider
-- is the source of truth for a club's name — and it silently destroys the
-- previous one. So a club that renames, or a provider that starts sending
-- "Manchester United" where it used to send "Man United", takes its old name
-- out of KIVO entirely: every search for it, and every human who knows it by
-- that name, stops finding anything.
--
-- A trigger rather than application code, for three reasons. It costs no extra
-- round trip, where the app would need to read the old row before writing.
-- It cannot be forgotten by a future write path. And it covers an admin
-- correcting a name by hand just as well as a sync, which application code in
-- the sync would not.
--
-- PROVENANCE STAYS HONEST. A rename is not a provider alias and not an admin
-- alias — the trigger genuinely cannot tell which of the two caused it, and
-- guessing would put a false source on a real row. So it gets its own value.
-- 'rename' means exactly what it says: this was this entity's name until it
-- was changed, and KIVO is not claiming to know who changed it.

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'entity_alias_source' and e.enumlabel = 'rename'
  ) then
    alter type entity_alias_source add value 'rename';
  end if;
end
$$;

-- Deliberately the whole of this migration. `alter type ... add value` commits
-- the new label, but Postgres will not let that label be *used* by anything in
-- the same transaction — so the trigger that writes 'rename' rows lives in
-- 0092. Splitting it is not tidiness; a single migration would fail at apply
-- time with "unsafe use of new value of enum type".

-- To reverse: an enum label cannot be dropped in Postgres. Reversing means
-- recreating `entity_alias_source` without 'rename' and re-pointing both alias
-- tables at it, which is only worth doing if the label is genuinely unused.
