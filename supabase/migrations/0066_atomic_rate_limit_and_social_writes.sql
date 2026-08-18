-- =============================================================================
-- 0066 — Three client-side "delete then insert" pairs become one statement each
-- =============================================================================
-- KIVO_NEXT_GEN.md KN-25 (checkRateLimit) and KN-23 (voteOnPoll / setReaction).
--
-- All three had the same shape: a Server Action doing two dependent writes over
-- two round trips, with no transaction spanning them. Between the two, anything
-- can happen — a concurrent request, a dropped connection, a serverless
-- function hitting its wall clock — and the user is left in a state neither
-- write intended.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. consume_rate_limit — KN-25
-- -----------------------------------------------------------------------------
-- `checkRateLimit` counted rows in the window, then inserted. Two concurrent
-- requests both read a count under the limit and both proceed, so the effective
-- ceiling under concurrency is higher than the configured one. The item is right
-- that this is tolerable for post spam and not tolerable for the OTP endpoints
-- the Supabase Auth migration introduced (KN-116) — an auth throttle that can be
-- raced is not a throttle, and racing it is exactly what an attacker does.
--
-- WHY A FUNCTION IS NOT ENOUGH ON ITS OWN, and what actually fixes it.
-- Moving both statements into one plpgsql function makes them one transaction,
-- which is necessary and not sufficient: under READ COMMITTED two concurrent
-- transactions still each take their own snapshot for the count, both see the
-- same under-limit number, and both insert. The count is not a row this
-- transaction can lock, because it is an absence of rows — there is nothing to
-- take a row lock on.
--
-- So the serialization is explicit: a transaction-scoped advisory lock keyed on
-- the (key, action) pair. Concurrent callers for the SAME key queue behind each
-- other and therefore see each other's inserts; callers for different keys never
-- contend at all, which is the right granularity — one abusive address must not
-- be able to slow down everybody else's writes. `pg_advisory_xact_lock` releases
-- on commit or rollback with nothing to clean up, and PostgREST wraps one RPC
-- call in one transaction, so the lock's lifetime is exactly this call.
--
-- Returning a boolean rather than raising: an over-limit result is an ordinary,
-- expected answer, and 0024 already learned the hard way what raising inside a
-- throttle costs — it aborts the transaction and rolls back the very insert that
-- makes the throttle slide.

create or replace function public.consume_rate_limit(
  p_key text,
  p_action text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_key is null or p_action is null or p_key = '' or p_action = '' then
    raise exception 'consume_rate_limit requires a non-empty key and action' using errcode = '22023';
  end if;
  if p_max_requests is null or p_max_requests < 1 then
    raise exception 'consume_rate_limit requires p_max_requests >= 1' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'consume_rate_limit requires p_window_seconds >= 1' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_action || ':' || p_key, 0));

  select count(*) into v_count
  from rate_limit_events
  where profile_id_or_ip = p_key
    and action = p_action
    and created_at >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max_requests then
    -- Deliberately NOT recorded. Recording refused attempts would make the
    -- window slide forward on every rejected retry, so a caller hammering the
    -- endpoint could hold themselves out indefinitely — a self-inflicted
    -- lockout, and a denial-of-service against any key an attacker can name
    -- (an email address, on the auth endpoints).
    return false;
  end if;

  insert into rate_limit_events (profile_id_or_ip, action) values (p_key, p_action);
  return true;
end;
$$;

comment on function public.consume_rate_limit(text, text, integer, integer) is
  'Atomically checks and records one sliding-window rate-limit event (KN-25). Returns true when the caller is allowed through. Serialized per (action, key) by a transaction-scoped advisory lock, because the count-then-insert it replaces could be raced. Service-role only: rate_limit_events has no client-facing RLS policy by design.';

-- Same posture as prune_rate_limit_events (0061): rate_limit_events is reached
-- only through the service-role client, so nothing else needs to call this.
revoke execute on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;


-- -----------------------------------------------------------------------------
-- 2. vote_on_poll and set_reaction — KN-23
-- -----------------------------------------------------------------------------
-- `reactions_unique_per_target` and `poll_votes_unique_per_user` mean only one
-- row per (target, user) can exist, so changing a vote or a reaction has to be
-- delete-then-insert. Done from the client that is two round trips: a failure
-- between them leaves the user with NOTHING where they had something a moment
-- earlier, while the error message says "Couldn't record your vote" — which
-- reads as "nothing changed".
--
-- SECURITY INVOKER, NOT SECURITY DEFINER — a deliberate departure from the
-- item's wording, and the more important decision in this section.
--
-- SECURITY DEFINER would bypass RLS, which means every rule the policies
-- currently enforce would have to be re-implemented inside these functions and
-- kept in sync by hand forever: ownership (`profile_id = current_profile_id()`),
-- and 0045's moderation gate, which is what stops a suspended or banned account
-- writing at all. Duplicating a security rule into a second place is how the two
-- copies drift, and the drift is silent.
--
-- SECURITY INVOKER gets the whole benefit with none of that. A function body is
-- part of the caller's transaction, so the delete and the insert commit together
-- or not at all — which is the entire point of the item — while every policy
-- still evaluates against the real caller exactly as it does today. Nothing here
-- can grant a permission the caller did not already have; these functions can
-- only make two writes the caller could already make happen atomically.
--
-- (private.current_profile_id() is itself SECURITY DEFINER and stays that way —
-- it has to be, or a policy on `profiles` reading `profiles` would recurse.)

create or replace function public.vote_on_poll(p_post_id uuid, p_option_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'You must be signed in to vote.' using errcode = '42501';
  end if;

  -- The trigger trg_poll_votes_set_post_id already overwrites post_id from the
  -- option's real poll, so a mismatched pair cannot corrupt the row — but it
  -- WOULD silently move the vote to a different poll than the UI showed, after
  -- the delete below has already cleared the vote on this one. Checked here so
  -- a stale or tampered pairing is a real error instead.
  if not exists (select 1 from poll_options where id = p_option_id and post_id = p_post_id) then
    raise exception 'That poll option no longer exists.' using errcode = 'P0002';
  end if;

  delete from poll_votes where post_id = p_post_id and profile_id = v_profile_id;
  insert into poll_votes (post_id, option_id, profile_id) values (p_post_id, p_option_id, v_profile_id);
end;
$$;

comment on function public.vote_on_poll(uuid, uuid) is
  'Records or changes the caller''s poll vote in one transaction (KN-23). SECURITY INVOKER on purpose: RLS stays the authorization boundary, this only makes the unavoidable delete-then-insert atomic.';

-- p_reaction_type null clears the caller's reaction (they tapped their active
-- one again), which is the same shape setReaction has always had.
create or replace function public.set_reaction(
  p_target_type reaction_target_type,
  p_target_id uuid,
  p_reaction_type reaction_type
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.current_profile_id();
begin
  if v_profile_id is null then
    raise exception 'You must be signed in to react.' using errcode = '42501';
  end if;

  delete from reactions
   where target_type = p_target_type
     and target_id = p_target_id
     and profile_id = v_profile_id;

  if p_reaction_type is not null then
    insert into reactions (target_type, target_id, profile_id, reaction_type)
    values (p_target_type, p_target_id, v_profile_id, p_reaction_type);
  end if;
end;
$$;

comment on function public.set_reaction(reaction_target_type, uuid, reaction_type) is
  'Sets or clears the caller''s reaction in one transaction (KN-23). SECURITY INVOKER: reactions_insert_own / reactions_delete_own and the moderation gate still apply.';

revoke execute on function public.vote_on_poll(uuid, uuid) from public, anon;
revoke execute on function public.set_reaction(reaction_target_type, uuid, reaction_type) from public, anon;
grant execute on function public.vote_on_poll(uuid, uuid) to authenticated;
grant execute on function public.set_reaction(reaction_target_type, uuid, reaction_type) to authenticated;


-- =============================================================================
-- To reverse
-- =============================================================================
-- drop function if exists public.consume_rate_limit(text, text, integer, integer);
-- drop function if exists public.vote_on_poll(uuid, uuid);
-- drop function if exists public.set_reaction(reaction_target_type, uuid, reaction_type);
-- ...and restore the two-round-trip versions in src/lib/rate-limit.ts and
-- src/app/(app)/social/actions.ts. Note the rate-limit one is a real
-- regression, not just a rollback: the throttle becomes raceable again.
