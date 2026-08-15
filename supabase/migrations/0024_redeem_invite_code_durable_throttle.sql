-- =============================================================================
-- Follow-up to 0019_security_hardening_recs_38_39_42.sql (RECOMMENDATIONS.md
-- item 42) -- fixes a correctness bug in that migration's throttle.
-- =============================================================================
--
-- 0019 recorded each redeem_invite_code attempt in rate_limit_events with a
-- plain `insert`, then still used `raise exception` for the "invalid code"
-- and "league full" outcomes. That insert and the later raise are part of
-- the SAME transaction (PostgREST wraps one RPC call in one implicit
-- transaction) -- an uncaught raise aborts and rolls back the whole
-- transaction, undoing that insert right along with it. Verified by hand:
-- five consecutive invalid-code attempts left rate_limit_events with zero
-- rows for the profile/action pair. Since a code-guessing attacker's
-- requests are almost all "invalid code", the throttle as originally
-- written never actually engaged against the attack it exists for.
--
-- Fix: keep raising for the two outcomes that happen *before* any write
-- (not signed in, already-throttled) -- nothing to lose by aborting there.
-- For the two outcomes that happen *after* the throttle-insert (invalid
-- code, league full), return a row with `error_message` set instead of
-- raising, so the function completes normally and that insert commits.
-- src/app/(app)/fantasy/actions.ts's joinFantasyLeague() reads a message
-- from either channel (thrown `error.message` or `data[0].error_message`)
-- and matches both against the same known-message set (item 41).
-- -----------------------------------------------------------------------------

drop function if exists public.redeem_invite_code(text);

create function public.redeem_invite_code(p_invite_code text)
returns table(id uuid, name text, season_id uuid, max_teams smallint, error_message text)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_league fantasy_leagues%rowtype;
  v_profile_id uuid;
  v_team_count integer;
  v_recent_attempts integer;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'You must be signed in to join a league.';
  end if;

  select count(*) into v_recent_attempts
  from rate_limit_events
  where profile_id_or_ip = v_profile_id::text
    and action = 'redeem_invite_code'
    and created_at >= now() - interval '60 seconds';

  if v_recent_attempts >= 5 then
    raise exception 'You are doing that a bit too fast. Please wait a moment and try again.';
  end if;

  -- Recorded before the lookup below, and nothing from here on raises, so a
  -- bad guess still counts toward the throttle -- see this migration's
  -- header comment for why that matters.
  insert into rate_limit_events (profile_id_or_ip, action)
  values (v_profile_id::text, 'redeem_invite_code');

  select * into v_league from fantasy_leagues fl where fl.invite_code = p_invite_code;
  if not found then
    return query select null::uuid, null::text, null::uuid, null::smallint,
      'Invalid invite code. Check the code and try again.'::text;
    return;
  end if;

  select count(*) into v_team_count from fantasy_teams ft where ft.league_id = v_league.id;
  if v_team_count >= v_league.max_teams and not exists (
    select 1 from fantasy_teams ft where ft.league_id = v_league.id and ft.owner_profile_id = v_profile_id
  ) then
    return query select null::uuid, null::text, null::uuid, null::smallint, 'This league is full.'::text;
    return;
  end if;

  insert into fantasy_teams (owner_profile_id, league_id, name)
  values (v_profile_id, v_league.id, 'My Team')
  on conflict (league_id, owner_profile_id) do nothing;

  return query select v_league.id, v_league.name, v_league.season_id, v_league.max_teams, null::text;
end;
$function$;

comment on function public.redeem_invite_code(text) is
  'Redeems a fantasy league invite code for the calling user. "Not signed in" and "too many attempts" raise (nothing written yet, safe to abort); "invalid code" and "league full" return a row with error_message set instead of raising, so the throttle attempt already recorded for this call is not rolled back with it. src/app/(app)/fantasy/actions.ts:joinFantasyLeague matches both channels against the same fixed, user-safe message set. Throttled to 5 attempts per rolling 60s per profile via rate_limit_events, independent of the app-layer checkRateLimit() call in joinFantasyLeague, since this RPC is directly callable by any authenticated client.';

revoke execute on function public.redeem_invite_code(text) from public;
revoke execute on function public.redeem_invite_code(text) from anon;
grant execute on function public.redeem_invite_code(text) to authenticated;

-- To reverse: this changes the function's own return signature (adds
-- error_message), so `drop function` first, then re-run 0019's create-or-
-- replace body to restore the raise-based version — that reopens the
-- rolled-back-throttle bug this migration exists to fix, so only do this if
-- you have a different fix in mind.
