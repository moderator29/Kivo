-- =============================================================================
-- RECOMMENDATIONS.md items 38 and 42 — security hardening
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Item 38: notifications_update_own let a user rewrite their own
-- notification's `type`/`payload` columns, not just mark it read (RLS is
-- row-scoped, not column-scoped, and the original policy's own comment
-- flagged this). Drop the broad UPDATE policy and replace it with a
-- SECURITY DEFINER RPC that only ever touches `read_at`, scoped to the
-- caller's own rows via private.current_profile_id() — the same ownership
-- check the dropped policy used, just enforced inside the function body
-- instead of at the row-security layer.
-- -----------------------------------------------------------------------------

drop policy if exists notifications_update_own on notifications;

-- No UPDATE policy remains for `authenticated` on notifications: all writes
-- to read_at now go through mark_notifications_read() below. Matches the
-- table's existing "no insert/delete for authenticated" comment — every
-- authenticated-role mutation path on this table is now an explicit RPC.
create or replace function public.mark_notifications_read(p_notification_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_profile_id uuid;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'You must be signed in.';
  end if;

  update notifications
  set read_at = now()
  where profile_id = v_profile_id
    and id = any(p_notification_ids)
    and read_at is null;
end;
$$;

comment on function public.mark_notifications_read(uuid[]) is
  'Marks the given notification ids as read for the calling user only (private.current_profile_id()). Only ever sets read_at — replaces the dropped notifications_update_own policy, which let a user rewrite type/payload on their own rows too.';

revoke execute on function public.mark_notifications_read(uuid[]) from public;
revoke execute on function public.mark_notifications_read(uuid[]) from anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- Item 42: six-character invite codes (alphabet 32, length 6 ~= 1e9 space)
-- have no throttle on the RPC itself. joinFantasyLeague() already rate-limits
-- the server action via checkRateLimit()/rate_limit_events (see
-- src/lib/rate-limit.ts and 0013_rate_limiting.sql), but redeem_invite_code
-- is `grant execute ... to authenticated`, so it's reachable directly via
-- PostgREST/supabase-js by any signed-in client, bypassing that app-layer
-- check entirely. Add the same sliding-window throttle inside the RPC,
-- reusing rate_limit_events (same table/shape checkRateLimit already reads
-- and writes) rather than inventing a second mechanism, keyed by profile id
-- since this RPC always requires sign-in first.
-- -----------------------------------------------------------------------------

create or replace function public.redeem_invite_code(p_invite_code text)
returns table(id uuid, name text, season_id uuid, max_teams smallint)
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

  insert into rate_limit_events (profile_id_or_ip, action)
  values (v_profile_id::text, 'redeem_invite_code');

  select * into v_league from fantasy_leagues fl where fl.invite_code = p_invite_code;
  if not found then
    raise exception 'Invalid invite code. Check the code and try again.';
  end if;

  select count(*) into v_team_count from fantasy_teams ft where ft.league_id = v_league.id;
  if v_team_count >= v_league.max_teams and not exists (
    select 1 from fantasy_teams ft where ft.league_id = v_league.id and ft.owner_profile_id = v_profile_id
  ) then
    raise exception 'This league is full.';
  end if;

  insert into fantasy_teams (owner_profile_id, league_id, name)
  values (v_profile_id, v_league.id, 'My Team')
  on conflict (league_id, owner_profile_id) do nothing;

  return query select v_league.id, v_league.name, v_league.season_id, v_league.max_teams;
end;
$function$;

comment on function public.redeem_invite_code(text) is
  'Redeems a fantasy league invite code for the calling user. Raises a fixed, user-safe set of messages by design (see src/app/(app)/fantasy/actions.ts:joinFantasyLeague, which matches against that exact set). Throttled to 5 attempts per rolling 60s per profile via rate_limit_events, independent of the app-layer checkRateLimit() call in joinFantasyLeague, since this RPC is directly callable by any authenticated client.';

-- redeem_invite_code is redefined (not newly created), so its grants from
-- 0008_fantasy_invite_code_grant_hardening.sql need reasserting — `create or
-- replace function` does not change existing grants, but being explicit here
-- keeps this migration correct standalone rather than relying on that.
revoke execute on function public.redeem_invite_code(text) from public;
revoke execute on function public.redeem_invite_code(text) from anon;
grant execute on function public.redeem_invite_code(text) to authenticated;
