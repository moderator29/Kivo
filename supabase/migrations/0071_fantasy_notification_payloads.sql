-- =============================================================================
-- 0071 — teach the notification payload validator about the fantasy producers
-- =============================================================================
--
-- KN-61 adds the first two fantasy notification producers KIVO has ever had:
-- `fantasy_points` (your squad scored N) and `fantasy_roster_carried` (you
-- never picked a squad, so we kept your last one and scored that).
--
-- Migration 0061's `notification_payload_is_valid` is deliberately permissive
-- about types it has never heard of — "a type this validator has never heard of
-- is a feature that shipped after it, not an error" — so both of these already
-- insert successfully. That permissiveness is a fallback, not a policy: it
-- exists so an older database cannot reject a newer release, and leaving these
-- two riding on it would mean the runtime guard silently covers seven of nine
-- producers while the type system covers nine.
--
-- Both payloads are required to carry `summary`, for the same reason every
-- match notification is: /notifications renders the line straight from the
-- payload and has no way to reconstruct a gameweek number or a points total
-- without a query per row.
-- =============================================================================

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
    -- Fantasy (KN-61): both land on /fantasy, so there is no id to require —
    -- what they cannot render without is the gameweek they are about and the
    -- summary line built at produce time.
    when 'fantasy_points' then (p_payload ? 'gameweek_number') and (p_payload ? 'summary')
    when 'fantasy_roster_carried'
      then (p_payload ? 'gameweek_number')
       and (p_payload ? 'carried_from_gameweek_number')
       and (p_payload ? 'summary')
    -- Deliberately permissive: a type this validator has never heard of is a
    -- feature that shipped after it, not an error.
    else true
  end;
$$;

comment on function public.notification_payload_is_valid(text, jsonb) is
  'CHECK-constraint validator for notifications.payload (KN-90, extended for the fantasy producers in KN-61). Requires the keys each known notification type needs to render its destination; permits unknown types, because notifications.type is free text by design.';

-- Grants are unchanged from 0061 and are restated only because CREATE OR
-- REPLACE on a function does not reset them — stated here so a reader of this
-- file alone knows the end state rather than having to diff two migrations.
revoke execute on function public.notification_payload_is_valid(text, jsonb) from public, anon, authenticated;
grant execute on function public.notification_payload_is_valid(text, jsonb) to service_role;

-- To reverse: re-run migration 0061's definition of this function verbatim.
