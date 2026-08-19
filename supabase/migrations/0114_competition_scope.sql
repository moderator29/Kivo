-- =============================================================================
-- Which competitions KIVO covers, as data the operator can change
-- =============================================================================
-- The founder asked for the top five European leagues first, and also for the
-- Saudi Pro League, MLS and an Asian league. Five of those seven shipped. The
-- other two did not, and neither did Nigeria's NPFL — for a reason worth
-- stating plainly, because it is the same reason this table exists:
--
--   NOBODY COULD ESTABLISH THE LEAGUE IDS WITH CERTAINTY, AND A WRONG LEAGUE ID
--   DOES NOT FAIL. It silently syncs a different competition.
--
-- That is not a hypothetical. The database this is being written against holds
-- 85 competitions — Emperor Cup, U19 Bundesliga, III Liga Group 2, Svenska
-- Cupen — because the pipeline took whatever happened to kick off. An id typed
-- from memory is the same class of mistake with a more confident face on it.
--
-- The shipped allowlist (DEFAULT_API_FOOTBALL_COMPETITIONS) is a constant in
-- TypeScript, so adding a competition to it means an engineer, a commit and a
-- deploy — and still means somebody typing a number. `FOOTBALL_SYNC_COMPETITION_IDS`
-- moves that to an environment variable, which is better but still a redeploy
-- and still a typed number.
--
-- This table is the third option and the right one: the operator picks a
-- competition FROM THE PROVIDER'S OWN REGISTRY, where every entry carries the
-- id, the name and the country the provider itself reports. Nobody types an id
-- and nobody guesses. `provider_coverage` (migration 0082, extended by 0107) is
-- filled by one `/leagues` request that returns every competition on the plan,
-- so the picker is free to browse.
--
-- -----------------------------------------------------------------------------
-- Precedence, and why the fallback chain is kept intact
-- -----------------------------------------------------------------------------
-- Rows here WIN over the environment variable and over the shipped default.
-- With no rows, nothing changes: the existing chain (env → shipped default →
-- unfiltered) applies exactly as before. An empty table means "this feature is
-- not in use", never "cover nothing" — an empty allowlist would scope every
-- sync down to zero and present to a reader as "there is no football", which is
-- the single worst thing this system can say.
--
-- -----------------------------------------------------------------------------
-- Publicly readable, service-role writable
-- -----------------------------------------------------------------------------
-- Which competitions KIVO covers is not a secret; it is visible on the matches
-- list to anyone who scrolls it. It has to be readable by the ordinary
-- server-side client because competition-ranking.ts reads it to order the
-- matches list for logged-out visitors. Writes have no policy at all, so they
-- are service-role only — the admin action is the only way in, exactly like
-- every other operator-controlled table here.

create table if not exists competition_scope (
  provider           text not null,
  provider_entity_id text not null,
  -- The operator's own order. This is the ONLY thing that decides which
  -- competition sorts first on the matches list within the covered tier, and
  -- it is deliberately not a judgement encoded anywhere in the code: an
  -- operator who puts the NPFL at position 0 gets the NPFL first.
  position           integer not null,
  -- Copied from the registry at the moment of adding, purely so the admin
  -- panel can name a row without a join and so a scope entry stays legible if
  -- the registry is later re-synced or trimmed. Never read as authority: the
  -- provider's registry is authority, this is a label.
  label              text,
  country            text,
  added_at           timestamptz not null default now(),
  primary key (provider, provider_entity_id),
  constraint competition_scope_provider_not_blank check (length(btrim(provider)) > 0),
  constraint competition_scope_entity_not_blank check (length(btrim(provider_entity_id)) > 0),
  constraint competition_scope_position_non_negative check (position >= 0)
);

comment on table competition_scope is
  'Operator-chosen competitions KIVO covers, in the operator''s own order. Rows here override FOOTBALL_SYNC_COMPETITION_IDS and the shipped default; an empty table means the feature is unused and the existing fallback chain applies, never "cover nothing". Entries are added by picking from provider_coverage so no league id is ever typed or guessed.';

comment on column competition_scope.position is
  'Sort order within the covered tier. Lower first. Nothing in the codebase ranks one competition above another — this column is the whole ranking.';

create index if not exists idx_competition_scope_provider_position
  on competition_scope (provider, position);

alter table competition_scope enable row level security;

-- Read: everyone. The matches list orders by this for signed-out visitors too,
-- and the covered set is already inferable from the list itself.
drop policy if exists competition_scope_select_public on competition_scope;
create policy competition_scope_select_public on competition_scope
  for select to anon, authenticated
  using (true);

comment on policy competition_scope_select_public on competition_scope is
  'Public read. Which competitions KIVO covers is visible on the matches list anyway, and competition-ranking.ts must be able to read it for a logged-out visitor. No insert/update/delete policy exists, so writes are service-role only.';

-- To reverse:
--   drop policy if exists competition_scope_select_public on competition_scope;
--   drop table if exists competition_scope;
