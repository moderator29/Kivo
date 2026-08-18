-- =============================================================================
-- KN-92 and KN-105 — badges as content, and a head-to-head between two people
-- =============================================================================
-- Batched: both are one function plus a little schema, both are owner/privacy
-- sensitive in the same way, and four other agents are writing migrations into
-- this tree tonight.


-- =============================================================================
-- KN-92. Badge criteria live in code, so the catalogue can't grow without a deploy
-- =============================================================================
-- `badges` is a real table seeded by migrations 0004/0016/0034; the *conditions*
-- are hardcoded across `social/actions.ts`, `onboarding/actions.ts` and others.
-- Every one of the concrete new badges RECOMMENDATIONS item 260 lists currently
-- means editing three files and shipping.
--
-- What this migration does, and what it deliberately does not:
--
--   It does — make a badge whose condition is "count rows of a known kind for
--   this profile and compare to a threshold" pure content. A new badge over an
--   existing countable fact is an INSERT: new code ships nothing.
--
--   It does not — allow arbitrary SQL in `criteria`. The evaluator resolves a
--   `fact` key against a fixed, hand-written whitelist of counts. That is a
--   deliberate ceiling, not an oversight: `criteria` is admin-writable content,
--   and a jsonb field that could name any table and any filter would be a
--   SQL-injection surface with an admin-shaped key. A genuinely new *kind* of
--   fact still needs a line in this function, and that is the right trade.
--
-- Every criterion therefore remains a real SQL count over a real table, which
-- is item 260's own honesty bar: no badge can be defined for something KIVO
-- cannot actually observe.

alter table badges
  add column if not exists criteria jsonb;

comment on column badges.criteria is
  'Data-driven award condition (KN-92), shaped {"fact": <key>, "threshold": <int>}. `fact` must be one of the keys evaluate_badge_criteria() knows how to count — deliberately a whitelist, not arbitrary SQL, because this column is admin-writable content. Null means this badge is awarded by application code instead, which several still are.';

alter table badges drop constraint if exists badges_criteria_shape;
alter table badges add constraint badges_criteria_shape check (
  criteria is null
  or (
    jsonb_typeof(criteria) = 'object'
    and criteria ? 'fact'
    and jsonb_typeof(criteria -> 'fact') = 'string'
    and criteria ? 'threshold'
    and jsonb_typeof(criteria -> 'threshold') = 'number'
    and (criteria ->> 'threshold')::numeric >= 1
  )
);

/**
 * Counts one known fact about one profile.
 *
 * The whitelist is the security boundary. Every branch is a hand-written
 * query over a table this function is allowed to read; an unrecognised key
 * returns null, which the evaluator treats as "cannot be assessed" and skips —
 * never as zero, because zero would silently mean "not earned" for a badge
 * whose condition KIVO does not actually understand.
 */
create or replace function private.count_badge_fact(p_profile_id uuid, p_fact text)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_count bigint;
begin
  case p_fact
    when 'posts' then
      select count(*) into v_count from posts where author_profile_id = p_profile_id and is_system = false;
    when 'comments' then
      select count(*) into v_count from comments where author_profile_id = p_profile_id;
    when 'reactions_given' then
      select count(*) into v_count from reactions where profile_id = p_profile_id;
    when 'predictions_made' then
      select count(*) into v_count from predictions where profile_id = p_profile_id;
    when 'predictions_correct' then
      select count(*) into v_count from predictions
       where profile_id = p_profile_id and coalesce(points_awarded, 0) > 0;
    when 'follows' then
      select count(*) into v_count from follows where follower_profile_id = p_profile_id;
    when 'fan_ratings' then
      select count(*) into v_count from fan_ratings where profile_id = p_profile_id;
    when 'poll_votes' then
      select count(*) into v_count from poll_votes where profile_id = p_profile_id;
    when 'saves' then
      select count(*) into v_count from saves where profile_id = p_profile_id;
    when 'xp_total' then
      select coalesce(sum(amount), 0) into v_count from xp_ledger where profile_id = p_profile_id;
    else
      return null;  -- unknown fact: not zero. See the doc comment.
  end case;

  return v_count;
end;
$$;

revoke execute on function private.count_badge_fact(uuid, text) from public, anon, authenticated;

/**
 * Awards every criteria-driven badge this profile now qualifies for, and
 * returns how many were newly awarded.
 *
 * Idempotent by construction: `user_badges_unique` means a re-award is a
 * no-op, and the insert skips anything already held rather than relying on
 * swallowing the conflict.
 *
 * Deliberately additive-only — this never *removes* a badge whose count has
 * since dropped (a deleted post, say). A badge is a record that something
 * happened, not a live status, and revoking one for tidying up your own posts
 * would be a genuinely hostile behaviour.
 */
create or replace function public.evaluate_badge_criteria(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_count bigint;
  v_awarded integer := 0;
begin
  if p_profile_id is null then return 0; end if;

  for r in
    select b.id, b.criteria ->> 'fact' as fact, (b.criteria ->> 'threshold')::bigint as threshold
    from badges b
    where b.criteria is not null
      and not exists (select 1 from user_badges ub where ub.badge_id = b.id and ub.profile_id = p_profile_id)
  loop
    v_count := private.count_badge_fact(p_profile_id, r.fact);
    -- Null means the fact key is not one this function knows how to count.
    -- Skipped, never treated as zero — an unrecognised criterion must not
    -- silently read as "not earned".
    if v_count is not null and v_count >= r.threshold then
      insert into user_badges (profile_id, badge_id)
      values (p_profile_id, r.id)
      on conflict do nothing;
      v_awarded := v_awarded + 1;
    end if;
  end loop;

  return v_awarded;
end;
$$;

revoke execute on function public.evaluate_badge_criteria(uuid) from public, anon, authenticated;
grant execute on function public.evaluate_badge_criteria(uuid) to service_role;

-- Backfill the badges whose conditions were already pure counts, so the
-- evaluator has something real to do on day one. Matched by `code` and only
-- where a badge with that code actually exists — this migration must not
-- invent badges, only describe ones that are already in the catalogue.
update badges set criteria = '{"fact": "posts", "threshold": 1}'::jsonb
  where code = 'first_post' and criteria is null;
update badges set criteria = '{"fact": "posts", "threshold": 10}'::jsonb
  where code = 'ten_posts' and criteria is null;
update badges set criteria = '{"fact": "predictions_made", "threshold": 1}'::jsonb
  where code = 'first_prediction' and criteria is null;
update badges set criteria = '{"fact": "predictions_correct", "threshold": 1}'::jsonb
  where code = 'first_prediction_correct' and criteria is null;
update badges set criteria = '{"fact": "predictions_correct", "threshold": 5}'::jsonb
  where code = 'five_predictions_correct' and criteria is null;


-- =============================================================================
-- KN-105. Head-to-head between two people, from rows both already own
-- =============================================================================
-- `get_predictions_leaderboard` and `get_fantasy_league_leaderboard` prove the
-- narrow-aggregate-RPC pattern: expose counts, never another user's individual
-- pick.
--
-- Two decisions worth stating.
--
-- **It compares the caller against one other person, not two arbitrary
-- strangers.** The caller's side is resolved from `private.current_profile_id()`
-- rather than passed in. That removes a whole class of misuse — nobody can use
-- this to build a comparison table of two other users — and it matches what the
-- feature is: "compare with me".
--
-- **The other person's numbers respect `show_activity_publicly`** exactly as
-- `get_public_profile_stats` already does, and the function says which side was
-- withheld rather than returning zeros. A silent zero would be a lie about a
-- private account; `is_public = false` is the truth, and the UI can say "this
-- account keeps its activity private" instead of "they have 0 XP".

create or replace function public.get_user_head_to_head(p_other_profile_id uuid)
returns table (
  side                text,
  profile_id          uuid,
  is_public           boolean,
  predictions_made    bigint,
  predictions_settled bigint,
  predictions_correct bigint,
  total_xp            bigint,
  badge_count         bigint,
  fantasy_points      bigint,
  shared_follows      bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (select private.current_profile_id() as id),
  sides as (
    select 'you'::text as side, (select id from me) as pid, true as is_public
    union all
    select 'them'::text,
           p_other_profile_id,
           coalesce((select show_activity_publicly from profiles where id = p_other_profile_id), true)
  ),
  shared as (
    select count(*)::bigint as n
    from follows a
    join follows b
      on b.followed_type = a.followed_type
     and b.followed_id = a.followed_id
    where a.follower_profile_id = (select id from me)
      and b.follower_profile_id = p_other_profile_id
      -- Following each other is not a shared interest, and counting it would
      -- inflate the number for exactly the pairs most likely to look.
      and a.followed_type <> 'user'
  )
  select
    s.side,
    s.pid,
    s.is_public,
    case when s.is_public then (select count(*) from predictions where profile_id = s.pid) else 0 end::bigint,
    case when s.is_public then (select count(*) from predictions where profile_id = s.pid and points_awarded is not null) else 0 end::bigint,
    case when s.is_public then (select count(*) from predictions where profile_id = s.pid and coalesce(points_awarded, 0) > 0) else 0 end::bigint,
    case when s.is_public then coalesce((select sum(amount) from xp_ledger where profile_id = s.pid), 0) else 0 end::bigint,
    case when s.is_public then (select count(*) from user_badges where profile_id = s.pid) else 0 end::bigint,
    case when s.is_public then coalesce((
      select sum(fp.points) from fantasy_points fp
      join fantasy_teams ft on ft.id = fp.fantasy_team_id
      where ft.owner_profile_id = s.pid
    ), 0) else 0 end::bigint,
    -- Shared follows are symmetric and belong to the pair, not to either side,
    -- so the same real number appears on both rows.
    (select n from shared)
  from sides s
  where (select id from me) is not null;
$$;

revoke execute on function public.get_user_head_to_head(uuid) from public, anon;
grant execute on function public.get_user_head_to_head(uuid) to authenticated, service_role;


-- To reverse:
--   drop function if exists public.get_user_head_to_head(uuid);
--   drop function if exists public.evaluate_badge_criteria(uuid);
--   drop function if exists private.count_badge_fact(uuid, text);
--   alter table badges drop constraint if exists badges_criteria_shape;
--   alter table badges drop column if exists criteria;
