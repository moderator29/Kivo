-- =============================================================================
-- KN-104: prediction leagues — the fantasy league mechanic, against predictions
-- =============================================================================
-- Predictions have real scoring (`predictions.points_awarded`, written by the
-- admin scoring pass) and a real global leaderboard, and no way at all to
-- compete with a specific group of friends. Fantasy has exactly that mechanic
-- already, proven, including a durable invite-code throttle that took two
-- migrations to get right (0019, then 0024's fix when it turned out the
-- throttle was being rolled back by its own raise).
--
-- So this deliberately mirrors that stack rather than inventing a second one,
-- **including the two bugs it has already paid for**:
--
--   * The throttle records the attempt and then *returns* an error row for the
--     outcomes that happen after the write, instead of raising. A raise aborts
--     the transaction and takes the throttle row with it — which is how the
--     fantasy throttle silently never engaged against the code-guessing attack
--     it exists for.
--   * Joining by invite code is a SECURITY DEFINER function, because league
--     membership is owner-scoped and a non-member must not need a base-table
--     SELECT to join.
--
-- What is deliberately *different* from fantasy: a prediction league has no
-- season and no squad, so there is nothing to carry forward and no roster to
-- lock. Membership is the whole model. That also means a member's score is a
-- pure function of predictions they were making anyway — joining a league
-- never changes what anyone predicts, it only changes who they see it beside.

create table if not exists prediction_leagues (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  creator_profile_id uuid not null references profiles (id) on delete cascade,
  invite_code        text unique,
  max_members        smallint not null default 50,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint prediction_leagues_name_length check (char_length(name) between 2 and 60),
  constraint prediction_leagues_max_members_positive check (max_members between 2 and 500)
);

create trigger trg_prediction_leagues_updated_at before update on prediction_leagues
  for each row execute function set_updated_at();

create table if not exists prediction_league_members (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references prediction_leagues (id) on delete cascade,
  profile_id  uuid not null references profiles (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  constraint prediction_league_members_unique unique (league_id, profile_id)
);

create index if not exists idx_prediction_league_members_profile
  on prediction_league_members (profile_id);
create index if not exists idx_prediction_league_members_league
  on prediction_league_members (league_id);

comment on table prediction_leagues is
  'Private prediction competitions (KN-104). Mirrors the fantasy league mechanic, without a season or a squad — membership is the whole model, and a member''s score is a pure function of predictions they were making anyway.';

alter table prediction_leagues enable row level security;
alter table prediction_league_members enable row level security;

-- A league is visible to its members and its creator. Deliberately not public:
-- a private league's name and existence are its members' business, and the
-- join path does not need a base-table SELECT because it goes through the
-- SECURITY DEFINER redeem function below.
create policy prediction_leagues_select_member on prediction_leagues
  for select to authenticated
  using (
    creator_profile_id = private.current_profile_id()
    or exists (
      select 1 from prediction_league_members m
      where m.league_id = prediction_leagues.id and m.profile_id = private.current_profile_id()
    )
  );

create policy prediction_leagues_insert_own on prediction_leagues
  for insert to authenticated
  with check (creator_profile_id = private.current_profile_id());

-- Rename and resize only. Deliberately no policy allowing `creator_profile_id`
-- to change: a league cannot be handed to somebody else, because that would
-- silently move every member into a competition run by a person they never
-- agreed to.
create policy prediction_leagues_update_creator on prediction_leagues
  for update to authenticated
  using (creator_profile_id = private.current_profile_id())
  with check (creator_profile_id = private.current_profile_id());

create policy prediction_leagues_delete_creator on prediction_leagues
  for delete to authenticated
  using (creator_profile_id = private.current_profile_id());

-- Members can see who else is in a league they are in. That is the point of a
-- league, and it is the same information the leaderboard shows.
create policy prediction_league_members_select_member on prediction_league_members
  for select to authenticated
  using (
    profile_id = private.current_profile_id()
    or exists (
      select 1 from prediction_league_members mine
      where mine.league_id = prediction_league_members.league_id
        and mine.profile_id = private.current_profile_id()
    )
  );

-- Leaving is a real action and must stay possible. Joining is not here on
-- purpose: it goes through `redeem_prediction_invite_code`, so there is exactly
-- one way in and it is the throttled one.
create policy prediction_league_members_delete_own on prediction_league_members
  for delete to authenticated
  using (profile_id = private.current_profile_id());


/**
 * Joins the caller to a league by invite code.
 *
 * The error-channel split is copied deliberately from `redeem_invite_code`
 * (migration 0024) and is the whole reason that migration exists: outcomes
 * *before* the throttle row is written may raise, because there is nothing to
 * lose by aborting. Outcomes *after* it must return a row instead — a raise
 * would roll back the throttle row along with everything else, which is exactly
 * how the fantasy throttle managed to never engage against the code-guessing
 * attack it was written for.
 */
create or replace function public.redeem_prediction_invite_code(p_invite_code text)
returns table (id uuid, name text, error_message text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_league prediction_leagues%rowtype;
  v_profile_id uuid;
  v_member_count integer;
  v_recent_attempts integer;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'You must be signed in to join a league.';
  end if;

  select count(*) into v_recent_attempts
  from rate_limit_events
  where profile_id_or_ip = v_profile_id::text
    and action = 'redeem_prediction_invite_code'
    and created_at >= now() - interval '60 seconds';

  if v_recent_attempts >= 5 then
    raise exception 'You are doing that a bit too fast. Please wait a moment and try again.';
  end if;

  -- Written before the lookup, and nothing below raises, so a wrong guess
  -- still counts toward the throttle.
  insert into rate_limit_events (profile_id_or_ip, action)
  values (v_profile_id::text, 'redeem_prediction_invite_code');

  select * into v_league from prediction_leagues pl where pl.invite_code = p_invite_code;
  if not found then
    return query select null::uuid, null::text,
      'Invalid invite code. Check the code and try again.'::text;
    return;
  end if;

  select count(*) into v_member_count
  from prediction_league_members m where m.league_id = v_league.id;

  if v_member_count >= v_league.max_members and not exists (
    select 1 from prediction_league_members m
    where m.league_id = v_league.id and m.profile_id = v_profile_id
  ) then
    return query select null::uuid, null::text, 'This league is full.'::text;
    return;
  end if;

  insert into prediction_league_members (league_id, profile_id)
  values (v_league.id, v_profile_id)
  on conflict (league_id, profile_id) do nothing;

  return query select v_league.id, v_league.name, null::text;
end;
$$;

revoke execute on function public.redeem_prediction_invite_code(text) from public, anon;
grant execute on function public.redeem_prediction_invite_code(text) to authenticated;

/**
 * The league table, for a league the caller is actually in.
 *
 * `SECURITY DEFINER` because it reads other members' `predictions` rows, which
 * `predictions_select_own` (correctly) forbids a plain query from touching.
 * The membership check at the top is therefore load-bearing rather than
 * decorative: without it this would expose any league's scores to anybody who
 * could guess a uuid.
 *
 * What it returns is a sum of `points_awarded` — points KIVO already awarded
 * for predictions each member made independently. It never exposes an
 * individual pick, only the total, which is the same rule
 * `get_predictions_leaderboard` and `get_prediction_consensus` already follow.
 *
 * `settled` is returned alongside so the UI can say "3 of 8 scored" rather than
 * presenting a partial total as final — half a league's fixtures being unscored
 * is the normal mid-week state, not an error.
 */
create or replace function public.get_prediction_league_leaderboard(p_league_id uuid)
returns table (
  profile_id     uuid,
  username       text,
  display_name   text,
  total_points   bigint,
  settled        bigint,
  correct        bigint,
  is_you         boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'You must be signed in.';
  end if;

  if not exists (
    select 1 from prediction_league_members m
    where m.league_id = p_league_id and m.profile_id = v_profile_id
  ) then
    raise exception 'You are not a member of that league.';
  end if;

  return query
    select
      m.profile_id,
      p.username::text,
      p.display_name,
      coalesce(sum(pr.points_awarded), 0)::bigint as total_points,
      count(pr.id) filter (where pr.points_awarded is not null)::bigint as settled,
      count(pr.id) filter (where coalesce(pr.points_awarded, 0) > 0)::bigint as correct,
      m.profile_id = v_profile_id as is_you
    from prediction_league_members m
    join profiles p on p.id = m.profile_id
    left join predictions pr on pr.profile_id = m.profile_id
    where m.league_id = p_league_id
    group by m.profile_id, p.username, p.display_name
    -- Points first, then correct calls as the tiebreak, then the earliest
    -- joiner — a stable order, never a random one.
    order by total_points desc, correct desc, min(m.joined_at) asc;
end;
$$;

revoke execute on function public.get_prediction_league_leaderboard(uuid) from public, anon;
grant execute on function public.get_prediction_league_leaderboard(uuid) to authenticated;


-- To reverse:
--   drop function if exists public.get_prediction_league_leaderboard(uuid);
--   drop function if exists public.redeem_prediction_invite_code(text);
--   drop table if exists prediction_league_members;
--   drop table if exists prediction_leagues;
