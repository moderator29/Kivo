-- =============================================================================
-- 0098 — Transfers: a limit, a cost, and a record of what changed
-- =============================================================================
-- The directive asks for transfer rules, a budget and a deadline, enforced on
-- the server. Budget and deadline exist. **Transfers do not exist at all.**
--
-- `setGameweekRoster` accepts any fifteen players that pass `validateRoster`,
-- so a manager can replace their entire squad every single gameweek, for free,
-- forever. That is not a fantasy game — the whole tension of the format is that
-- a change costs something, and without it there is no reason to think about
-- next week when picking this week.
--
-- It also leaves the directive's "what changed" with nothing to read: KIVO
-- stores each gameweek's squad, so a diff is computable, but nothing records
-- that a change WAS a transfer, when it happened, or what it cost.
--
-- THE RULE, and why this one.
--
--   * One free transfer per gameweek. Every further change costs 4 points.
--   * The FIRST squad a team ever sets is free and unlimited — there is no
--     previous squad to have transferred out of.
--   * Changes are counted against the PREVIOUS gameweek's squad, never against
--     whatever this gameweek's roster happened to contain a moment ago.
--
-- That last one is the important one and it is not arbitrary. Roster rows for a
-- gameweek are created by carry-forward and then edited, possibly many times,
-- before the deadline. Counting each edit would charge a manager for changing
-- their mind — swap a player in, swap them back out, and they are two transfers
-- down having ended where they started. Diffing against last week's squad makes
-- the cost a function of the NET change, which is the rule every established
-- fantasy game uses and the only one that survives a manager tinkering.
--
-- The numbers live in TypeScript (`fantasy-rules.ts`), not here, and that is the
-- opposite of the choice made for the SCORING rules in 0095. The distinction is
-- deliberate: a scoring rule has to be re-readable years later to explain a
-- stored number, so it is versioned data. A transfer rule is enforced at the
-- moment of the save and its outcome is recorded as an absolute points cost on
-- the row, so the row stays explicable even if the rule changes.

create table if not exists fantasy_transfers (
  id                uuid primary key default gen_random_uuid(),
  fantasy_team_id   uuid not null references fantasy_teams (id) on delete cascade,
  gameweek_id       uuid not null references fantasy_gameweeks (id) on delete cascade,
  -- Both sides of the swap. A transfer is a pair, and storing only the incoming
  -- player would make "what changed" unanswerable in the direction managers
  -- actually ask it ("who did I sell?").
  player_in_id      uuid not null references players (id) on delete cascade,
  player_out_id     uuid not null references players (id) on delete cascade,
  -- Whether this one was covered by the free allowance. Stored rather than
  -- derived from position-in-list, because the allowance may change and a past
  -- transfer has to keep saying what it actually was.
  is_free           boolean not null,
  -- The absolute cost applied, in points, at the time of the save. Zero for a
  -- free transfer. Recorded as a number rather than recomputed from a rule so a
  -- past gameweek stays explicable after the rule changes.
  points_cost       smallint not null default 0,
  created_at        timestamptz not null default now(),
  -- A player cannot be transferred in twice in the same gameweek by the same
  -- team; the diff that produces these rows cannot generate a duplicate, and
  -- the constraint is what keeps that true if a second writer ever appears.
  constraint fantasy_transfers_unique_in unique (fantasy_team_id, gameweek_id, player_in_id),
  constraint fantasy_transfers_distinct_players check (player_in_id <> player_out_id),
  constraint fantasy_transfers_cost_non_positive check (points_cost <= 0)
);

comment on table fantasy_transfers is
  'One row per player swapped in a gameweek, counted as the NET change from the previous gameweek''s squad rather than per edit — so a manager who changes their mind and changes it back pays nothing. points_cost is the absolute cost applied at save time, stored rather than recomputed, so a past gameweek stays explicable after the rule changes.';

create index if not exists idx_fantasy_transfers_team_gameweek
  on fantasy_transfers (fantasy_team_id, gameweek_id);
create index if not exists idx_fantasy_transfers_gameweek on fantasy_transfers (gameweek_id);
create index if not exists idx_fantasy_transfers_player_in on fantasy_transfers (player_in_id);
create index if not exists idx_fantasy_transfers_player_out on fantasy_transfers (player_out_id);

alter table fantasy_transfers enable row level security;

-- Read: owner only, matching fantasy_rosters' own SELECT policy exactly. A
-- transfer reveals a squad decision, so it cannot be more visible than the
-- squad.
--
-- Write: none. Same reasoning as migration 0097 for `fantasy_rosters`, and the
-- same reasoning applies more sharply here — how many transfers a save counts
-- as, and what it costs, is a property of the DIFF between two whole squads,
-- which no per-row policy can evaluate. The validated action is the only
-- writer, as service_role.
create policy fantasy_transfers_select_own on fantasy_transfers
  for select to authenticated
  using (exists (
    select 1 from fantasy_teams t
    where t.id = fantasy_transfers.fantasy_team_id and t.owner_profile_id = private.current_profile_id()
  ));

-- -----------------------------------------------------------------------------
-- The cost has to reach the score
-- -----------------------------------------------------------------------------
-- Kept as its own column rather than folded into `points`, for the same reason
-- 0095 itemised the rest: a total with a deduction invisibly baked into it
-- cannot be checked. The scorecard's reconciliation is now
--
--     sum(breakdown.total_points) + transfer_points_cost = points
--
-- and a manager who took a hit sees the hit as a line rather than as four
-- missing points they cannot account for.
alter table fantasy_points add column if not exists transfer_points_cost smallint not null default 0;

comment on column fantasy_points.transfer_points_cost is
  'Points deducted for transfers beyond the free allowance, as a non-positive number. Separate from `points` so the itemised breakdown still reconciles: sum(breakdown.total_points) + transfer_points_cost = points.';

-- To reverse:
--   alter table fantasy_points drop column if exists transfer_points_cost;
--   drop table if exists fantasy_transfers;
