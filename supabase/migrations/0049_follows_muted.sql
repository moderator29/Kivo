-- =============================================================================
-- Per-team/per-player mute (RECOMMENDATIONS.md item 287)
-- =============================================================================
-- notification_preferences (0001) is a flat one-row-per-profile table of
-- eight booleans with no team/player/competition dimension -- there is
-- nowhere to hang "mute Everton specifically" on it, and adding one column
-- per followed entity doesn't fit a fixed-column table at all. `follows` is
-- already the real per-team/per-player join row match-notifications.ts's
-- teamAudience()/playerAudience() query to build a notification's audience
-- in the first place, so muting belongs here: keep match alerts on globally
-- (item 285's match_alerts_enabled) but silence one specific followed
-- team/player.
--
-- `not null default false` rather than a nullable column (the dispatch
-- brief's own wording said "nullable-default-false", but a mute flag has no
-- honest third meaning the way moderation_status genuinely does with three
-- real states) -- every existing follow starts unmuted, and the column can
-- never be null to be misread as "unknown."
alter table follows add column muted boolean not null default false;

-- No update policy existed on `follows` at all before this migration (only
-- follows_select_own/follows_insert_own/follows_delete_own, see 0001) --
-- muting requires flipping one column on an existing row in place, not
-- delete-then-reinsert. Mirrors every other user-owned mutating policy this
-- schema has added since migration 0045: same own-row guard as
-- follows_insert_own, plus the same
-- `and not private.is_moderation_write_blocked()` a suspended/banned user
-- already gets on every other one of their own rows (posts, comments,
-- reactions, predictions, fan ratings, poll votes, saves, follows inserts).
create policy follows_update_own on follows
  for update to authenticated
  using (follower_profile_id = private.current_profile_id())
  with check (follower_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

-- To reverse: drop policy follows_update_own on follows; alter table follows
-- drop column muted.
