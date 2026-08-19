-- =============================================================================
-- The Match Room's posting window, enforced in the database
-- =============================================================================
-- The founder's rule, in their words: "make it open even if the match is not
-- live yet ... make it open for people to chat about for that match ... should
-- only be closed to chat after 24hrs after match ended."
--
-- Before this migration KIVO had no time gate on Room posts anywhere. Not a
-- weak one — none. `posts_insert_own` checks ownership and nothing else, and
-- `createPost` never looked at the fixture. A room from three seasons ago
-- accepted new posts exactly as readily as tonight's.
--
-- The application now checks the window too (src/lib/match-room-guard.ts), and
-- that check is worth nothing on its own: `posts` is writable through PostgREST
-- with the same publishable key the browser already holds, so a rule that lives
-- only in a server action is a rule that only applies to people who use the
-- server action. This file is the boundary. The action's version exists to
-- produce a sentence a human can read instead of a raw policy rejection.
--
-- -----------------------------------------------------------------------------
-- Why RESTRICTIVE, and not a fourth rewrite of posts_insert_own
-- -----------------------------------------------------------------------------
-- Same reasoning migration 0103 sets out at length. Permissive policies are
-- OR-ed, so folding this into `posts_insert_own` means a later permissive
-- INSERT policy silently reopens it; and that policy has already been rewritten
-- by 0045, 0047 and 0095 for three unrelated reasons. RESTRICTIVE policies are
-- AND-ed with whatever the permissive set decides, so this adds one orthogonal
-- bound that cannot be switched off by adding a policy.
--
-- -----------------------------------------------------------------------------
-- The two hours
-- -----------------------------------------------------------------------------
-- KIVO does not record when a match ENDED. `fixtures` has `kickoff_at` and a
-- status; nothing writes a finish time. So "24 hours after the match ended"
-- cannot be computed exactly from what exists, and the options were to invent a
-- finish time, to add a column and backfill it with a guess, or to say plainly
-- what is being approximated.
--
-- This takes the third, identically to src/lib/match-room-window.ts, which is
-- the same rule in TypeScript for the UI. Expected end is kickoff + 2 hours —
-- 90 minutes, half-time and stoppage, which is essentially every match that
-- does not go to extra time. A match that does go to extra time and penalties
-- runs perhaps 40 minutes longer, so its room closes ~23 hours after the final
-- whistle rather than 24. That error is in the harmless direction and it is
-- written down here rather than hidden.
--
-- THESE TWO NUMBERS EXIST TWICE, IN THIS FILE AND IN match-room-window.ts, AND
-- THEY MUST AGREE. A UI that hides the composer while the policy still accepts
-- posts is merely untidy; a UI that shows the composer while the policy refuses
-- is a fan typing a paragraph into a box that throws it away. If you change one,
-- change the other, and run src/lib/match-room-window.test.ts.
--
-- -----------------------------------------------------------------------------
-- What is deliberately NOT gated
-- -----------------------------------------------------------------------------
-- Reactions and poll votes. "Closed to chat" is about new speech; a reaction is
-- an acknowledgement of something already said, and a poll left open collects
-- the answer it exists to collect. Stated so the omission reads as a decision
-- rather than something that was missed.
--
-- Reading is never gated. A closed room keeps every post, poll and result on
-- screen — closing means "no new posts", never "this conversation is gone".

-- -----------------------------------------------------------------------------
-- The predicate
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER for the reason 0103 documents: an inline subquery inside a
-- policy is evaluated with RLS applied to that read, so its answer is only as
-- complete as `fixtures_select_public` happens to be at the time. That policy is
-- public today. A window that silently reopens if it ever narrows is not a
-- window. Reading as owner makes the answer exact regardless.
--
-- Safe to take an argument: it returns one boolean about a fixture's public
-- kickoff time and status. There is no row it can be pointed at that would
-- disclose anything `fixtures_select_public` does not already publish.
create or replace function private.match_room_accepts_posts(p_fixture_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select now() < f.kickoff_at
        -- A match nobody will play has no final whistle to measure from, so its
        -- own scheduled kickoff is the only honest anchor. Still a full day of
        -- room either side of it — a postponement is worth talking about.
        + case when f.status in ('cancelled', 'postponed', 'abandoned')
               then interval '0'
               else interval '120 minutes'
          end
        + interval '24 hours'
      from fixtures f
      where f.id = p_fixture_id
    ),
    -- No such fixture. Not this function's decision: the foreign key on
    -- posts.fixture_id refuses the insert anyway, with a clearer cause than a
    -- fabricated "this room is closed".
    true
  );
$$;

revoke execute on function private.match_room_accepts_posts(uuid) from public;

comment on function private.match_room_accepts_posts(uuid) is
  'True while a fixture''s Match Room takes new posts: from the moment the fixture exists until 24h after its expected final whistle (kickoff + 2h), or 24h after kickoff for a cancelled/postponed/abandoned match. Mirrors matchRoomWindow() in src/lib/match-room-window.ts — change both together.';

-- -----------------------------------------------------------------------------
-- The policy
-- -----------------------------------------------------------------------------
-- `to authenticated` only, exactly as 0103's ceilings are. `service_role`
-- bypasses RLS entirely, so KIVO's own automatic goal and red-card
-- announcements (migration 0047) are unaffected by construction — a system post
-- about a goal is written by the system, during the match, and is not the caller
-- this bounds.
--
-- INSERT only. `posts.fixture_id` is `on delete set null`, so gating UPDATE
-- would turn a deleted fixture into a wall a user cannot edit their own post
-- past — and editing an old post is not chatting in a closed room.
drop policy if exists posts_insert_match_room_window on posts;
create policy posts_insert_match_room_window on posts
  as restrictive
  for insert to authenticated
  with check (fixture_id is null or private.match_room_accepts_posts(fixture_id));

comment on policy posts_insert_match_room_window on posts is
  'A Match Room takes new posts from the moment its fixture exists until 24h after full time. Restrictive so it cannot be turned off by adding a permissive policy. Unscoped posts (fixture_id is null) are untouched.';

-- -----------------------------------------------------------------------------
-- Comments in a Room are chat too
-- -----------------------------------------------------------------------------
-- Gating posts and leaving replies open would close the front door of a room
-- and leave every window open: a closed room would still accept an unbounded
-- thread hanging off any post in it. A comment on a post that is not
-- Room-scoped — the whole of /social — is unaffected.
create or replace function private.comment_room_accepts_posts(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select private.match_room_accepts_posts(p.fixture_id)
      from posts p
      where p.id = p_post_id
        and p.fixture_id is not null
    ),
    -- Either the post does not exist (the foreign key refuses it) or it is not
    -- Room-scoped (nothing to gate). Both are "not this policy's business".
    true
  );
$$;

revoke execute on function private.comment_room_accepts_posts(uuid) from public;

comment on function private.comment_room_accepts_posts(uuid) is
  'True unless the commented-on post belongs to a Match Room whose posting window has closed. Always true for an ordinary /social post.';

drop policy if exists comments_insert_match_room_window on comments;
create policy comments_insert_match_room_window on comments
  as restrictive
  for insert to authenticated
  with check (private.comment_room_accepts_posts(post_id));

comment on policy comments_insert_match_room_window on comments is
  'A reply in a Match Room closes when the room does, 24h after full time. Comments on ordinary posts are untouched.';

-- To reverse:
--   drop policy if exists comments_insert_match_room_window on comments;
--   drop policy if exists posts_insert_match_room_window on posts;
--   drop function if exists private.comment_room_accepts_posts(uuid);
--   drop function if exists private.match_room_accepts_posts(uuid);
