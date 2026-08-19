-- =============================================================================
-- Three notification types KIVO already had the data for and never sent
-- =============================================================================
-- The founding brief's notification list names, among others, half time,
-- penalties and lineups released. All three are already in KIVO's database and
-- none of them ever reached anybody:
--
--   halftime          `fixture_status` has had a 'halftime' value since 0001,
--                     and notifyFixtureStatusChange only ever branched on
--                     'live' and 'finished'. A real, observed transition was
--                     being watched and thrown away.
--   penalty           `fixture_event_type` has 'penalty_goal' and
--                     'penalty_missed'. A scored penalty went out as a generic
--                     goal; a missed one reached only the taker's own
--                     followers, which is the one group least surprised by it.
--   lineups released  `lineups` rows land through the details sync. The single
--                     most time-sensitive pre-match moment in football
--                     produced no notification at all.
--
-- This migration is the database half: KN-90's payload validator (0061) has to
-- know the shape of a type before that type can be written, or the CHECK
-- constraint passes it through on the `else true` branch and the guarantee
-- quietly stops applying to the newest three types in the system.
--
-- Same requirement as every other match notification: the fixture it links to,
-- and the summary line built at produce time from team names the renderer
-- never sees.
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
    -- The three added here. Identical shape to their siblings above, because
    -- they are the same kind of thing: a moment in a match, linking to that
    -- match, described by a line only the producer can write.
    when 'match_halftime' then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    when 'match_penalty'  then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    when 'match_lineups'  then (p_payload ? 'fixture_id') and (p_payload ? 'summary')
    -- Deliberately permissive: a type this validator has never heard of is a
    -- feature that shipped after it, not an error.
    else true
  end;
$$;

comment on function public.notification_payload_is_valid(text, jsonb) is
  'CHECK-constraint validator for notifications.payload (KN-90). Requires the keys each known notification type needs to render its destination; permits unknown types, because notifications.type is free text by design.';

-- `create or replace` preserves grants, but this project has had a recreated
-- function silently lose them, so they are restated rather than assumed.
revoke execute on function public.notification_payload_is_valid(text, jsonb) from public, anon, authenticated;
grant execute on function public.notification_payload_is_valid(text, jsonb) to service_role;

-- The constraint already points at this function by name, so nothing about it
-- needs re-creating — but existing rows are re-validated below to prove the
-- new definition did not invalidate anything already stored.
--   select count(*) from notifications
--   where not public.notification_payload_is_valid(type, payload);
--   -- expected: 0

-- To reverse: restore the 0061 definition of
-- public.notification_payload_is_valid(text, jsonb) (drop the three
-- match_halftime / match_penalty / match_lineups branches).
