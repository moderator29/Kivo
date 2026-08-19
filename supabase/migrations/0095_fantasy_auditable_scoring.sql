-- =============================================================================
-- 0095 — Fantasy scoring that can be audited, and that refuses to guess
-- =============================================================================
-- The founding directive's sentence about fantasy is the one this migration
-- exists for: **every awarded point must trace to verified match/player data,
-- and KIVO must never silently calculate fantasy points from missing data.**
--
-- Today it does both of the things that sentence forbids, and neither is
-- visible from the outside:
--
--   1. `fantasy_points` stores ONE INTEGER. `scoreRosterSlot` computes the
--      components — the appearance, each goal at its position weight, the
--      clean sheet, the cards — and throws every one of them away. A manager
--      cannot ask why they got 47, and neither can KIVO. That is a number that
--      appears rather than a number that traces.
--
--   2. A fixture with `status = 'finished'` whose EVENTS have never been synced
--      produces no rows in `fixture_events`, so a player who scored a hat-trick
--      scores the 2-point appearance and nothing else — and it is written as a
--      final-looking total. The same is true of a gameweek scored while half
--      its fixtures are still to play. Both are calculating from missing data;
--      both currently look identical to a correct score.
--
-- The second is the same distinction the coverage registry (0082) draws for
-- tabs — "structurally empty" versus "not synced yet" — applied to points.
--
-- Four things here:
--   1. fantasy_scoring_rulesets   what a version actually MEANT
--   2. fantasy_point_breakdowns   one row per player per gameweek, itemised
--   3. fantasy_points completeness columns
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO, and the reasoning behind it,
-- because the question will come up again.
--
-- It does not touch `fantasy_rosters`' policies. The security sweep found the
-- same deadline gap independently and landed the fix first: `fantasy_rosters_
-- all_own` is dropped, and four policies replace it — SELECT on ownership only
-- (so a manager can still read a locked squad and their own history), and
-- INSERT/UPDATE/DELETE each carrying ownership AND `deadline_at > now()`. That
-- is applied and it stands. All RLS changes now go through that agent, so this
-- migration stays out of the policy set entirely rather than creating a second
-- set of differently-named policies that RLS would OR together and that would
-- quietly diverge.
--
-- THE QUESTION IT LEAVES, answered here because the next person will face it:
-- can a policy carry the REST of the squad rules as well as the deadline?
--
-- The deadline can. It is a fact about ONE row — this row's gameweek is still
-- open — so a per-row `WITH CHECK` can decide it, which is why the applied fix
-- works.
--
-- **The budget, the per-club cap, the squad size and the formation cannot.**
-- Every one of them is a property of the SET of fifteen rows, not of any row in
-- it: "this squad costs 99.5 of 100" is unanswerable while looking at one
-- player. RLS evaluates `WITH CHECK` per row, so a policy could only count rows
-- already committed — and `setGameweekRoster` deletes departing players before
-- upserting the new squad, so mid-statement the set is legitimately
-- inconsistent. A per-row rule counting its siblings would reject valid saves
-- depending on write order, and would still be satisfiable by a caller who
-- wrote fifteen rows one at a time in a convenient order.
--
-- So for those four rules the honest conclusion is that the validated action
-- must be the ONLY writer, and the policy should be written so that it is —
-- rather than a partial predicate that looks like data-layer enforcement while
-- leaving the set-level rules open, which is the worst of the options because
-- it is the one that stops people checking. The residual gap that leaves today
-- (a user can still write a rule-breaking squad directly before the deadline)
-- is recorded with the security agent rather than patched from here.
--
-- Duplicating the whole rule set into a SECURITY DEFINER SQL function was
-- considered and rejected: it would make two authoritative copies of the squad
-- rules, in two languages, and the failure mode of that is a squad the UI
-- accepts and the database rejects — or worse, the reverse.


-- -----------------------------------------------------------------------------
-- 1. fantasy_scoring_rulesets — versioning that survives a rule change
-- -----------------------------------------------------------------------------
-- `SCORING_MODEL_VERSION = '1.0'` is already stamped onto every scored row
-- (0052), which is genuinely better than nothing. But it is a LABEL: the rule
-- values live only in TypeScript constants, so nothing records what "1.0"
-- meant. Two consequences, and the directive names the second one:
--
--   * a past gameweek cannot be re-explained under the ruleset that produced
--     it — the breakdown below would be itemised against today's numbers, and
--     the arithmetic would not add up to the stored total;
--   * re-running the scorer on an old gameweek silently rescores it under the
--     new rules. Last week's scores move, and nothing says so.
--
-- Storing the values makes the version mean something. The FORMULA stays in
-- TypeScript (`scoreRosterSlot`) — a shape, not a number — and the numbers come
-- from here. That split is deliberate: a fully data-driven formula would be a
-- small interpreter nobody can read, and a fully hardcoded one is what this
-- migration is fixing.
create table if not exists fantasy_scoring_rulesets (
  version         text primary key,
  -- Every constant, verbatim, in the shape `parseScoringRules` validates.
  -- jsonb rather than columns because the rule SET will change shape over time
  -- (a future version might add a bonus this one has no concept of), and a
  -- column per rule would need a migration to add each one — which is exactly
  -- the friction that stops a ruleset being versioned properly.
  rules           jsonb not null,
  -- The published explanation as it stood for this version, so the "how
  -- scoring works" text a manager read at the time can be recovered even after
  -- the current copy has moved on.
  summary         text[] not null,
  effective_from  timestamptz not null default now(),
  -- Set when a version stops being the one new scoring runs use. Never
  -- deleted: a superseded ruleset still has to explain the rows it produced.
  retired_at      timestamptz,
  created_at      timestamptz not null default now()
);

comment on table fantasy_scoring_rulesets is
  'What a fantasy scoring version actually meant. The formula lives in TypeScript; the numbers live here, so a past gameweek can be re-explained under the ruleset that produced it and a rule change cannot silently move last week''s scores. Rows are never deleted — a superseded ruleset still has to explain its own rows.';

alter table fantasy_scoring_rulesets enable row level security;

-- Readable by any signed-in user: this is the published rulebook, and a
-- manager disputing a score has to be able to see the rules that produced it.
-- Writes are admin-only; in practice a ruleset is seeded by a migration.
create policy fantasy_scoring_rulesets_select_public on fantasy_scoring_rulesets
  for select to authenticated using (true);
create policy fantasy_scoring_rulesets_write_admin on fantasy_scoring_rulesets
  for all to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- Version 1.0, transcribed from src/lib/fantasy-scoring.ts as it stands at this
-- migration. NOT invented here: if these numbers and the constants in that file
-- ever disagree, the file is authoritative for NEW scoring and this row is
-- authoritative for what already happened — which is the whole point of
-- recording it. `fantasy-scoring.test.ts` asserts they agree today.
insert into fantasy_scoring_rulesets (version, rules, summary)
values (
  '1.0',
  jsonb_build_object(
    'appearance', 2,
    'assist', 3,
    'cleanSheet', 4,
    'yellowCard', -1,
    'redCard', -3,
    'ownGoal', -2,
    'flatGoal', 5,
    'captainMultiplier', 2,
    'goalByPosition', jsonb_build_object(
      'Goalkeepers', 6, 'Defenders', 6, 'Midfielders', 5, 'Forwards', 4
    ),
    'cleanSheetEligible', jsonb_build_array('Goalkeepers', 'Defenders')
  ),
  array[
    'Starting XI: +2 pts. Bench players score 0.',
    'Goal: GK/DEF +6, MID +5, FWD +4.',
    'Assist: +3 pts.',
    'Clean sheet (GK/DEF, team concedes 0): +4 pts.',
    'Yellow card: -1 pts. Red card or second yellow: -3 pts.',
    'Own goal: -2 pts.',
    'Captain: points doubled. Vice-captain doubles instead only if the captain wasn''t in the starting XI.'
  ]
)
on conflict (version) do nothing;


-- -----------------------------------------------------------------------------
-- 2. fantasy_point_breakdowns — the audit trail
-- -----------------------------------------------------------------------------
-- One row per (team, gameweek, player). Both the COUNTS (two goals, one clean
-- sheet) and the POINTS those counts produced are stored, because storing only
-- one of them makes the other unverifiable: counts alone cannot be checked
-- against the total, and points alone cannot be checked against the match.
--
-- With both, a manager's score is arithmetic they can follow, and a wrong point
-- is traceable to either a wrong count (a sync problem) or a wrong rate (a rule
-- problem) — which are different bugs with different fixes.
create table if not exists fantasy_point_breakdowns (
  id                    uuid primary key default gen_random_uuid(),
  fantasy_team_id       uuid not null references fantasy_teams (id) on delete cascade,
  gameweek_id           uuid not null references fantasy_gameweeks (id) on delete cascade,
  player_id             uuid not null references players (id) on delete cascade,

  is_starting           boolean not null,
  -- 1 or 2. Stored rather than inferred from is_captain, because the
  -- vice-captain can carry the double instead and the reason is a fact about
  -- this gameweek that the roster row alone does not record.
  multiplier            smallint not null default 1,

  -- What actually happened, from real fixture_events.
  goals                 smallint not null default 0,
  assists               smallint not null default 0,
  own_goals             smallint not null default 0,
  yellow_cards          smallint not null default 0,
  red_cards             smallint not null default 0,
  clean_sheets          smallint not null default 0,

  -- What each of those was worth under the ruleset named below. Pre-multiplier,
  -- so the captain double is visible as a separate step rather than baked into
  -- every line — a manager checking their captain's return should be able to
  -- see the base and the double.
  appearance_points     integer not null default 0,
  goal_points           integer not null default 0,
  assist_points         integer not null default 0,
  own_goal_points       integer not null default 0,
  card_points           integer not null default 0,
  clean_sheet_points    integer not null default 0,
  -- The slot's final contribution, after the multiplier. Sums to the team's
  -- fantasy_points.points for the gameweek, and that identity is what makes
  -- this an audit trail rather than a decoration.
  total_points          integer not null,

  scoring_model_version text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint fantasy_point_breakdowns_unique_slot unique (fantasy_team_id, gameweek_id, player_id),
  constraint fantasy_point_breakdowns_multiplier_known check (multiplier in (1, 2)),
  constraint fantasy_point_breakdowns_counts_non_negative check (
    goals >= 0 and assists >= 0 and own_goals >= 0
    and yellow_cards >= 0 and red_cards >= 0 and clean_sheets >= 0
  )
);

comment on table fantasy_point_breakdowns is
  'Itemised fantasy points: one row per player per gameweek per team, holding both the real counts from fixture_events and the points each produced under the named ruleset. total_points sums to fantasy_points.points — that identity is what makes a score auditable rather than asserted.';

create trigger trg_fantasy_point_breakdowns_updated_at before update on fantasy_point_breakdowns
  for each row execute function set_updated_at();

create index if not exists idx_fantasy_point_breakdowns_team_gameweek
  on fantasy_point_breakdowns (fantasy_team_id, gameweek_id);
create index if not exists idx_fantasy_point_breakdowns_player
  on fantasy_point_breakdowns (player_id);
create index if not exists idx_fantasy_point_breakdowns_gameweek
  on fantasy_point_breakdowns (gameweek_id);

alter table fantasy_point_breakdowns enable row level security;

-- Owner-only, matching fantasy_points' own policy exactly. A breakdown is a
-- more detailed view of a score, so it cannot be more visible than the score.
-- Writes are service-role only (the scorer), which bypasses RLS — no write
-- policy is granted to authenticated at all, deliberately: nothing a user does
-- should ever write their own points.
create policy fantasy_point_breakdowns_select_own on fantasy_point_breakdowns
  for select to authenticated
  using (exists (
    select 1 from fantasy_teams t
    where t.id = fantasy_point_breakdowns.fantasy_team_id
      and t.owner_profile_id = private.current_profile_id()
  ));


-- -----------------------------------------------------------------------------
-- 3. fantasy_points — say how complete the score is
-- -----------------------------------------------------------------------------
-- The columns that stop a partial score looking final.
--
-- `fixtures_with_events` is the one that closes the silent-wrong-score hole. A
-- finished fixture with zero synced events is indistinguishable, in the points
-- it produces, from a 0-0 in which nobody was booked — the scorer sees no
-- events either way. Counting how many finished fixtures actually HAVE events
-- is what lets a score say "some of this week's matches have no match data yet"
-- instead of quietly under-scoring every player who did something in them.
alter table fantasy_points add column if not exists status text not null default 'provisional';
alter table fantasy_points add column if not exists fixtures_total smallint;
alter table fantasy_points add column if not exists fixtures_finished smallint;
alter table fantasy_points add column if not exists fixtures_with_events smallint;
alter table fantasy_points add column if not exists computed_at timestamptz;

-- Existing rows predate the distinction and cannot be classified honestly after
-- the fact, so they are left 'provisional' by the default above rather than
-- promoted to 'final' — claiming a completeness that was never measured would
-- be the same fabrication in a smaller place.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fantasy_points_status_known'
  ) then
    alter table fantasy_points add constraint fantasy_points_status_known
      check (status in ('provisional', 'final'));
  end if;
end $$;

comment on column fantasy_points.status is
  '''final'' only when every fixture in the gameweek has finished AND has synced match events. Anything else is ''provisional'' — a score that may still move, which the UI must say rather than present as settled.';
comment on column fantasy_points.fixtures_with_events is
  'How many of the finished fixtures actually have rows in fixture_events. A finished fixture with no synced events scores every player as if nothing happened, so this is the number that distinguishes a real 0-0 from missing data.';


-- To reverse:
--   alter table fantasy_points drop column if exists computed_at, drop column if exists fixtures_with_events,
--     drop column if exists fixtures_finished, drop column if exists fixtures_total, drop column if exists status;
--   drop table if exists fantasy_point_breakdowns;
--   drop table if exists fantasy_scoring_rulesets;
