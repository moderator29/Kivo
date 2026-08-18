-- =============================================================================
-- System-authored live event posts inside Match Rooms (RECOMMENDATIONS.md
-- item 254), plus the RLS lockdown that keeps them un-forgeable.
-- =============================================================================
-- Match Room posts are ordinary `posts` rows (fixture_id set) — see
-- src/components/matches/match-room.tsx. When a real goal or red card lands
-- via sync-match-details.ts's upsertFixtureEvent (the exact same trigger
-- match-notifications.ts's notifyFixtureEvent already hooks), KIVO now also
-- inserts a system-authored post into that fixture's Room
-- ("⚽ GOAL — Player Name (Team), 67'") — see
-- src/lib/football/match-room-system-posts.ts.
--
-- Two things had to be true for this to be safe, not just functional:
--
-- 1. `posts.author_profile_id` is `not null references profiles` (0001) — a
--    system post still needs a REAL profiles row to satisfy the FK, not a
--    fabricated one. `kivo_system` below is that row: a real, permanent,
--    clearly-labeled ("KIVO") account with a clerk_user_id sentinel that can
--    never collide with a genuine Clerk-issued id (every real one is
--    "user_..."; this one deliberately isn't), so no real Clerk webhook
--    event and no real authenticated session can ever match it. That also
--    means no real user can ever pass posts_update_own's/posts_insert_own's
--    `author_profile_id = private.current_profile_id()` check as this
--    profile — it is reachable only from server code holding the
--    service-role key (which bypasses RLS outright), exactly where
--    match-room-system-posts.ts's insert runs from.
--
-- 2. `is_system` itself must be un-forgeable independent of (1). Without a
--    RLS guard, any authenticated user could call the Supabase client
--    directly (bypassing the app's own createPost server action entirely)
--    and insert `is_system: true` on their OWN real post — the FK problem
--    above doesn't stop that, since they'd still be inserting as themselves,
--    not as the system profile. That would let a real user dress up their
--    own post with KIVO's system badge and impersonate an official match
--    update, which is exactly what item 254 says must never happen. So
--    posts_insert_own/posts_update_own (already extended once by
--    0045_moderation_status for the moderation-write-blocked guard) get a
--    second, additive `and is_system = false` clause on their self-service
--    WITH CHECK — same "pin the field a self-service write must never
--    control" pattern 0045 used for moderation_status on profiles_insert_own.
--    Only a service-role write (RLS doesn't apply to it at all) can ever set
--    is_system = true. Read access is untouched: posts_select_public (and
--    its 0045 shadow-mute carve-out) already covers every column on the row,
--    is_system included, so no new SELECT policy is needed for the client to
--    see and badge these posts.
-- =============================================================================

alter table posts add column is_system boolean not null default false;

comment on column posts.is_system is
  'True only for a KIVO-authored (not user-authored) post — e.g. an automatic goal/red-card announcement inserted by match-room-system-posts.ts off a real fixture_events insert. Always false for anything a real user posted. Locked to false on self-service insert/update by posts_insert_own/posts_update_own below; only a service-role write can set it true.';

drop policy posts_insert_own on posts;
create policy posts_insert_own on posts
  for insert to authenticated
  with check (author_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked() and is_system = false);

drop policy posts_update_own on posts;
create policy posts_update_own on posts
  for update to authenticated
  using (author_profile_id = private.current_profile_id())
  with check (author_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked() and is_system = false);

-- The real, permanent KIVO system account. clerk_user_id is a deliberate
-- sentinel (not "user_..." shaped, so it can never match a genuine Clerk
-- JWT sub or a real webhook payload). role stays the 'user' default — this
-- account authors posts, it is never granted admin capability by virtue of
-- existing. moderation_status stays the 'active' default; nothing in this
-- codebase's admin moderation UI targets it, and it never authenticates so a
-- restriction on it would be inert anyway.
insert into profiles (username, clerk_user_id, display_name)
values ('kivo_system', 'system:kivo_official_account', 'KIVO')
on conflict (username) do nothing;

-- To reverse: delete from profiles where username = 'kivo_system' (cascades
-- to any is_system posts it authored, via posts_author_profile_id_fkey's
-- "on delete cascade" — do this ONLY if every system post should also be
-- gone); drop policy posts_update_own on posts, recreate exactly as
-- 0045_moderation_status left it (drop the trailing "and is_system = false");
-- drop policy posts_insert_own on posts, recreate exactly as
-- 0045_moderation_status left it (same); alter table posts drop column
-- is_system.
