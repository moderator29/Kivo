-- =============================================================================
-- KN-91, KN-90, KN-93 — three small, independent integrity fixes
-- =============================================================================
-- Batched because each is a handful of lines and none depends on the others,
-- and because four other agents are writing migrations into this tree right
-- now: three files would be three more chances at a numbering collision.
--
-- Same grant rule as migration 0056: this project's default privileges grant
-- EXECUTE on new public-schema functions to `anon` explicitly, so `revoke from
-- public` does not strip it (see migration 0025). Every function below revokes
-- by name.


-- =============================================================================
-- KN-91. A retried award must not credit XP twice
-- =============================================================================
-- `awardXp` inserts an amount and a reason string with nothing stopping the
-- same award landing twice. Every path that calls it can be retried — by the
-- user double-submitting, by the framework re-running a Server Action, by an
-- admin re-running the prediction scoring pass — and XP is a trust-sensitive
-- ledger. Double-credit here is not cosmetic: it is the leaderboard being
-- wrong for everyone.
--
-- Nullable, with a partial unique index rather than a NOT NULL column and a
-- backfill. Two reasons, and neither is convenience:
--   * There is no honest key to backfill existing rows with. A synthetic one
--     would assert that two historical rows were or were not the same award,
--     which nothing in the data can support.
--   * Not every award has a natural identity. "Posted in the community" keyed
--     on the post id does; a future award that genuinely can recur has no key,
--     and forcing one would mean inventing it. A null `source_key` means "this
--     award is not deduplicated", stated rather than implied.

alter table xp_ledger
  add column if not exists source_key text;

comment on column xp_ledger.source_key is
  'Stable identity of the real-world action that earned this XP, e.g. "prediction:<uuid>" (KN-91). Unique per profile where present, so a retried award is refused rather than credited twice. Null means this award is deliberately not deduplicated — never a placeholder.';

-- Partial: null source keys are exempt, and NULLs would be distinct in a
-- plain unique index anyway. Scoped per profile, not globally — two users
-- earning XP from the same fixture is two legitimate awards.
create unique index if not exists idx_xp_ledger_source_key
  on xp_ledger (profile_id, source_key)
  where source_key is not null;

-- Length bounded so a caller cannot turn this into a free-text field.
alter table xp_ledger drop constraint if exists xp_ledger_source_key_shape;
alter table xp_ledger add constraint xp_ledger_source_key_shape check (
  source_key is null or (char_length(source_key) between 1 and 200)
);


-- =============================================================================
-- KN-90. `notifications.payload` is untyped jsonb and five producers disagree
-- =============================================================================
-- `notification-registry.ts` reads every payload with optional chaining and a
-- fallback, which is exactly right for rendering and exactly wrong as the only
-- guarantee: a producer that drops `post_id` still writes a perfectly valid
-- row, and the notification renders looking fine while its link goes nowhere.
--
-- The important design decision here is what is *not* constrained. `type` stays
-- free text — migration 0001's column comment is explicit that notification
-- types grow continuously as features ship, and turning it into an enum would
-- make every new notification a migration. So the validator knows the types
-- that exist today, requires what each of them genuinely needs to render its
-- link, and returns true for anything it does not recognise. It catches drift
-- in a known producer, which is the actual bug; it does not gate new ones.
--
-- IMMUTABLE and a pure function of its two arguments, which is what makes it
-- legal in a CHECK constraint.

create or replace function public.notification_payload_is_valid(p_type text, p_payload jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select case p_type
    -- Social: the link is to a post, so the post id is the one thing without
    -- which the notification is undeliverable as a destination.
    when 'post_like'     then p_payload ? 'post_id'
    when 'post_comment'  then p_payload ? 'post_id'
    when 'comment_reply' then p_payload ? 'post_id'
    -- Follows link to the follower's profile, which is found by username.
    when 'new_follower'  then p_payload ? 'follower_username'
    -- Match events link to the fixture and render a pre-built summary line;
    -- both are required because the renderer has no way to reconstruct either.
    when 'match_kickoff'  then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    when 'match_result'   then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    when 'match_goal'     then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    when 'match_red_card' then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    when 'player_event'   then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    -- Deliberately permissive: a type this validator has never heard of is a
    -- feature that shipped after it, not an error. See the note above.
    else true
  end;
$$;

comment on function public.notification_payload_is_valid(text, jsonb) is
  'CHECK-constraint validator for notifications.payload (KN-90). Requires the keys each known notification type needs to render its destination; permits unknown types, because notifications.type is free text by design.';

revoke execute on function public.notification_payload_is_valid(text, jsonb) from public, anon, authenticated;
grant execute on function public.notification_payload_is_valid(text, jsonb) to service_role;

alter table notifications drop constraint if exists notifications_payload_shape;
alter table notifications add constraint notifications_payload_shape
  check (public.notification_payload_is_valid(type, payload));


-- =============================================================================
-- KN-93. Rate-limit cleanup does not belong inside a user request
-- =============================================================================
-- `src/lib/rate-limit.ts` sweeps `rate_limit_events` on a 1-in-200 roll inside
-- `checkRateLimit`, which sits on the first line of essentially every write in
-- the product. It was a sound design for a $0 budget with no scheduler: the
-- sliding window opportunistically kept its own table from growing forever.
--
-- Two things are wrong with it now. The delete is unbounded — its cost scales
-- with total platform activity, and one unlucky user in two hundred pays that
-- cost inside a latency-sensitive path. And a scheduler now exists.
--
-- So the sweep moves to the scheduled job, and this function is what both it
-- and the (now much rarer, and *bounded*) in-request backstop call. `p_max_rows`
-- is the part that matters: even the backstop can no longer issue an unbounded
-- delete. The scheduled caller passes a large budget and can run again; the
-- backstop passes a small one.

create or replace function public.prune_rate_limit_events(
  p_older_than_seconds integer default 86400,
  p_max_rows integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_older_than_seconds is null or p_older_than_seconds < 60 then
    raise exception 'refusing to prune rate_limit_events younger than 60 seconds'
      using errcode = '22023';
  end if;

  with doomed as (
    select id from rate_limit_events
     where created_at < now() - make_interval(secs => p_older_than_seconds)
     order by created_at
     limit greatest(coalesce(p_max_rows, 5000), 1)
  )
  delete from rate_limit_events r using doomed d where r.id = d.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.prune_rate_limit_events(integer, integer) is
  'Bounded sweep of expired rate_limit_events rows (KN-93). Row-capped so it can never become an unbounded delete, wherever it is called from. Service-role only.';

revoke execute on function public.prune_rate_limit_events(integer, integer) from public, anon, authenticated;
grant execute on function public.prune_rate_limit_events(integer, integer) to service_role;


-- To reverse:
--   drop function if exists public.prune_rate_limit_events(integer, integer);
--   alter table notifications drop constraint if exists notifications_payload_shape;
--   drop function if exists public.notification_payload_is_valid(text, jsonb);
--   alter table xp_ledger drop constraint if exists xp_ledger_source_key_shape;
--   drop index if exists idx_xp_ledger_source_key;
--   alter table xp_ledger drop column if exists source_key;
