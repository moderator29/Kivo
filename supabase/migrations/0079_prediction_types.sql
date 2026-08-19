-- =============================================================================
-- The six prediction types the founding brief names
-- =============================================================================
-- KIVO ships one: pick home / draw / away. The brief names six — winner,
-- correct score, first scorer, total goals, cards & corners, and man of the
-- match — and every one of the other five resolves from data KIVO already
-- syncs. Nothing here needs a new provider call:
--
--   correct score   fixtures.home_score / away_score
--   total goals     the same two columns
--   first scorer    fixture_events (goal / penalty_goal), ordered by minute
--   cards & corners fixture_statistics (yellow_cards, red_cards, corners)
--   man of the match the Room's own MOTM poll (migration 0078) — see below
--
-- One prediction per match becomes six, off data that is already on disk.
--
-- -----------------------------------------------------------------------------
-- The honest part, and it is the whole design
-- -----------------------------------------------------------------------------
-- Two of these types depend on data that is synced *separately* from the score.
-- A finished fixture always has a score; it does not always have its events or
-- its team statistics, because those come from a different endpoint and an
-- admin-triggered detail sync that may simply not have run.
--
-- A scoring pass that meets that state has exactly three options. It can call
-- the prediction wrong (a lie — the user may well have been right). It can
-- leave it silently pending forever (which reads as a bug). Or it can say what
-- is true: this cannot be settled, and here is why.
--
-- So `points_awarded` is no longer the only state. `resolution` carries the
-- third answer explicitly, and `points_awarded` stays NULL when a prediction is
-- unresolvable — which keeps it out of the leaderboard sum entirely, because a
-- prediction KIVO could not settle must not cost the user anything. The row is
-- re-examined on every later scoring pass, so a detail sync that lands next
-- week settles it for real.
--
-- MOTM has no provider field anywhere in KIVO's schema, and inventing one would
-- be fabrication. Its only real source is the room's own vote — which, since
-- migration 0078, is a first-class MOTM poll whose options carry real
-- `players.id` values seeded from a synced lineup. So a MOTM prediction is
-- settled by that vote, under a minimum sample and a no-ties rule, and both the
-- prediction UI and the result say so in those words. Where no MOTM poll exists,
-- or too few people voted, or the room tied: unresolvable. Never a guess.

-- -----------------------------------------------------------------------------
-- Types
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prediction_type') then
    create type prediction_type as enum (
      'winner', 'correct_score', 'first_scorer', 'total_goals', 'cards_corners', 'motm'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'prediction_resolution') then
    -- 'unresolvable' is not an error state. It is a factual one: the data this
    -- type needs was never synced for this fixture, and KIVO says so rather
    -- than scoring a zero it cannot justify.
    create type prediction_resolution as enum ('correct', 'incorrect', 'unresolvable');
  end if;

  -- Bands, not exact counts, for the two aggregate types. An exact-corner-count
  -- prediction is unwinnable often enough to be a joke rather than a game, and
  -- a band is what a fan actually has an opinion about. The boundaries are
  -- stated once, here, and mirrored in src/lib/predictions.ts.
  if not exists (select 1 from pg_type where typname = 'total_goals_band') then
    create type total_goals_band as enum ('goals_0_1', 'goals_2_3', 'goals_4_plus');
  end if;

  if not exists (select 1 from pg_type where typname = 'cards_band') then
    create type cards_band as enum ('cards_0_2', 'cards_3_4', 'cards_5_plus');
  end if;

  if not exists (select 1 from pg_type where typname = 'corners_band') then
    create type corners_band as enum ('corners_0_8', 'corners_9_12', 'corners_13_plus');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- predictions: one row per (profile, fixture, type)
-- -----------------------------------------------------------------------------
-- `default 'winner'` is what makes this migration safe on existing rows: every
-- prediction written before today was a winner pick, so the default states a
-- fact about the existing data rather than filling a gap with a guess.
alter table predictions
  add column if not exists prediction_type prediction_type not null default 'winner';

-- predicted_outcome is only meaningful for the 'winner' type now. The
-- payload check constraint below is what keeps it required there.
alter table predictions alter column predicted_outcome drop not null;

alter table predictions
  add column if not exists predicted_home_score smallint,
  add column if not exists predicted_away_score smallint,
  add column if not exists predicted_player_id uuid,
  add column if not exists predicted_total_goals total_goals_band,
  add column if not exists predicted_cards cards_band,
  add column if not exists predicted_corners corners_band,
  add column if not exists resolution prediction_resolution,
  add column if not exists unresolvable_reason text,
  add column if not exists resolved_at timestamptz;

comment on column predictions.resolution is
  'What the scoring pass concluded. NULL = not yet examined. ''unresolvable'' = the data this type needs was not synced for this fixture; points_awarded stays NULL so it costs the user nothing, and a later pass re-examines it.';

comment on column predictions.unresolvable_reason is
  'Plain-language reason a prediction could not be settled, shown to the user verbatim. Only set alongside resolution = ''unresolvable''.';

-- ON DELETE RESTRICT, matching predictions_fixture_restrict (0020): a
-- prediction naming a player is a record of what someone actually said, and
-- nulling the player out of it would turn that record into an unreadable one.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'predictions_predicted_player_id_fkey') then
    alter table predictions
      add constraint predictions_predicted_player_id_fkey
      foreign key (predicted_player_id) references players (id) on delete restrict;
  end if;
end
$$;

-- Scores are a real football range, not an unbounded integer. 20 is far past
-- any professional result and still refuses obvious junk.
alter table predictions drop constraint if exists predictions_score_range;
alter table predictions add constraint predictions_score_range check (
  (predicted_home_score is null or predicted_home_score between 0 and 20)
  and (predicted_away_score is null or predicted_away_score between 0 and 20)
);

-- Exactly the payload its own type requires, and nothing from another type.
-- Without this, a 'correct_score' row with no scores on it is a perfectly valid
-- database row that the scoring pass can only treat as a bug.
alter table predictions drop constraint if exists predictions_payload_matches_type;
alter table predictions add constraint predictions_payload_matches_type check (
  case prediction_type
    when 'winner' then
      predicted_outcome is not null
    when 'correct_score' then
      predicted_home_score is not null and predicted_away_score is not null
    when 'first_scorer' then
      predicted_player_id is not null
    when 'total_goals' then
      predicted_total_goals is not null
    when 'cards_corners' then
      predicted_cards is not null and predicted_corners is not null
    when 'motm' then
      predicted_player_id is not null
  end
);

-- A reason belongs to an unresolvable verdict and nowhere else, so a stale
-- reason cannot survive a later pass that actually settled the row.
alter table predictions drop constraint if exists predictions_reason_only_when_unresolvable;
alter table predictions add constraint predictions_reason_only_when_unresolvable check (
  unresolvable_reason is null or resolution = 'unresolvable'
);

-- An unresolvable prediction must never carry points — that is the entire
-- promise this migration makes, so it is a constraint and not a convention.
alter table predictions drop constraint if exists predictions_unresolvable_has_no_points;
alter table predictions add constraint predictions_unresolvable_has_no_points check (
  resolution is distinct from 'unresolvable' or points_awarded is null
);

-- One pick per type per match, replacing one pick per match.
alter table predictions drop constraint if exists predictions_unique_per_fixture;
alter table predictions drop constraint if exists predictions_unique_per_fixture_type;
alter table predictions add constraint predictions_unique_per_fixture_type
  unique (profile_id, fixture_id, prediction_type);

-- The scoring pass's own read: "unscored rows for these fixtures".
create index if not exists idx_predictions_unscored
  on predictions (fixture_id)
  where points_awarded is null;

create index if not exists idx_predictions_predicted_player_id
  on predictions (predicted_player_id)
  where predicted_player_id is not null;

-- -----------------------------------------------------------------------------
-- Consensus: winner picks only
-- -----------------------------------------------------------------------------
-- get_prediction_consensus (0032) groups every prediction row by
-- predicted_outcome. With five more types in the table, most of those rows now
-- have a NULL outcome, and an un-filtered group-by would return a NULL bucket
-- that the consensus bar would silently render as part of its denominator —
-- turning a real percentage into a wrong one.
--
-- Same name, same signature, same return shape, so `create or replace` keeps
-- the existing grants rather than dropping them; they are re-stated below
-- anyway, because a function that quietly loses its grants has happened on this
-- project before.
create or replace function public.get_prediction_consensus(p_fixture_ids uuid[])
returns table (
  fixture_id        uuid,
  predicted_outcome prediction_outcome,
  pick_count        bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select fixture_id, predicted_outcome, count(*)::bigint as pick_count
  from predictions
  where fixture_id = any(p_fixture_ids)
    and prediction_type = 'winner'
    and predicted_outcome is not null
  group by fixture_id, predicted_outcome;
$$;

revoke execute on function public.get_prediction_consensus(uuid[]) from public;
grant execute on function public.get_prediction_consensus(uuid[]) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Per-type accuracy, for the leaderboard's breakdown
-- -----------------------------------------------------------------------------
-- get_predictions_leaderboard (0012) already returns the summed points that
-- rank people, and it stays exactly as it is — the ranking does not change,
-- because points are points regardless of which type earned them.
--
-- What the leaderboard could not say before is *how* someone got there: six
-- correct winner picks and one correct scoreline are the same number and very
-- different claims. This returns the real per-type split for one profile, over
-- resolved rows only, and counts unresolvable rows separately rather than
-- folding them into misses — because they are not misses.
create or replace function public.get_prediction_type_breakdown(p_profile_id uuid)
returns table (
  prediction_type      prediction_type,
  settled_count        bigint,
  correct_count        bigint,
  unresolvable_count   bigint,
  points               bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    p.prediction_type,
    count(*) filter (where p.points_awarded is not null)::bigint as settled_count,
    count(*) filter (where p.points_awarded > 0)::bigint         as correct_count,
    count(*) filter (where p.resolution = 'unresolvable')::bigint as unresolvable_count,
    coalesce(sum(p.points_awarded) filter (where p.points_awarded is not null), 0)::bigint as points
  from predictions p
  where p.profile_id = p_profile_id
  group by p.prediction_type;
$$;

revoke execute on function public.get_prediction_type_breakdown(uuid) from public;
revoke execute on function public.get_prediction_type_breakdown(uuid) from anon;
grant execute on function public.get_prediction_type_breakdown(uuid) to authenticated;

-- To reverse:
--   drop function if exists public.get_prediction_type_breakdown(uuid);
--   (restore get_prediction_consensus from 0032)
--   drop index if exists idx_predictions_predicted_player_id;
--   drop index if exists idx_predictions_unscored;
--   alter table predictions drop constraint predictions_unique_per_fixture_type;
--   alter table predictions add constraint predictions_unique_per_fixture unique (profile_id, fixture_id);
--   alter table predictions drop constraint predictions_unresolvable_has_no_points;
--   alter table predictions drop constraint predictions_reason_only_when_unresolvable;
--   alter table predictions drop constraint predictions_payload_matches_type;
--   alter table predictions drop constraint predictions_score_range;
--   alter table predictions drop constraint predictions_predicted_player_id_fkey;
--   alter table predictions drop column resolved_at, drop column unresolvable_reason,
--     drop column resolution, drop column predicted_corners, drop column predicted_cards,
--     drop column predicted_total_goals, drop column predicted_player_id,
--     drop column predicted_away_score, drop column predicted_home_score,
--     drop column prediction_type;
--   alter table predictions alter column predicted_outcome set not null;
--   drop type corners_band; drop type cards_band; drop type total_goals_band;
--   drop type prediction_resolution; drop type prediction_type;
