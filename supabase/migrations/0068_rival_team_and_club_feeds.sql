-- =============================================================================
-- Rival club, and the two club-scoped feed reads that need one
-- =============================================================================
-- The founder asked /social for two filters KIVO had no way to answer:
-- "Club mates" (people who support the same club as you) and "Rivals".
--
-- Club mates was already answerable from real data — profiles.favourite_team_id
-- has existed since 0001 and is set during onboarding. Rivals was not: nothing
-- in this schema has ever recorded who anyone's rival is. Two honest options
-- existed, and this migration deliberately takes the narrower one:
--
--   (a) a `team_rivalries` table — an editorial dataset of which clubs are
--       derbies. KIVO has no provider field for it and no editor to curate it,
--       so it would have to be typed in by hand and would be wrong the moment
--       a league changes. Inventing "Arsenal's rival is Tottenham" in code is
--       exactly the fabricated-data line this product does not cross.
--   (b) `profiles.rival_team_id` — the user says who their rival is, the same
--       way they already say who they support. One rival, chosen deliberately,
--       always true because the person whose feed it filters is the one who
--       set it.
--
-- (b) it is. Nothing is derived, inferred or seeded: a profile with no
-- rival_team_id has no Rivals feed, and the UI says so plainly instead of
-- guessing one from the league table.
--
-- The hard rule that a user supports exactly one club is unchanged —
-- favourite_team_id is still a single nullable column, and rival_team_id is
-- its single-valued mirror. The check constraint below stops the one
-- nonsensical combination: naming your own club as your rival.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. profiles.rival_team_id
-- -----------------------------------------------------------------------------
-- `on delete set null` matches favourite_team_id's own behaviour: if a club
-- row is ever removed, the profile survives without one rather than blocking
-- the delete or leaving a dangling id.

alter table profiles
  add column rival_team_id uuid references teams (id) on delete set null;

comment on column profiles.rival_team_id is
  'The one club this user has named as their rival, set by them in /settings/clubs. Never inferred, never seeded — KIVO has no rivalry dataset, so an unset value means "this user has not told us", and the Rivals feed says exactly that rather than guessing. Owner-editable through the existing profiles_update_own_or_admin policy, same path favourite_team_id/bio/country already use; no new policy needed.';

alter table profiles
  add constraint profiles_rival_is_not_favourite
  check (rival_team_id is null or rival_team_id is distinct from favourite_team_id);


-- -----------------------------------------------------------------------------
-- 2. Index for the club-scoped feed reads
-- -----------------------------------------------------------------------------
-- Both feeds below start from "every profile whose favourite_team_id is X".
-- Partial, because the overwhelming majority of a profiles table's rows are
-- irrelevant to that question the moment the column is null.

create index if not exists idx_profiles_favourite_team
  on profiles (favourite_team_id)
  where favourite_team_id is not null;


-- -----------------------------------------------------------------------------
-- 3. get_team_feed_post_ids(): the one read both new filters need
-- -----------------------------------------------------------------------------
-- Club mates and Rivals are the same query with a different team id — "posts
-- by people whose favourite club is X". The join it needs crosses an RLS
-- boundary: profiles_select_own_or_admin (0045) restricts a plain select on
-- `profiles` to the caller's own row, so a client-side join would silently
-- return zero rows forever rather than error. That is the quiet-wrong-data
-- failure this codebase has repeatedly chosen a narrow SECURITY DEFINER
-- function over.
--
-- Two things this function is careful about:
--
--  * It returns post ids, not profile ids. A function that answered "who
--    supports Arsenal" would hand out a membership roster of every account on
--    the platform in one call. This answers "which posts belong in this feed",
--    which is the question actually being asked, is bounded by a page size,
--    and reveals nothing a reader would not learn by scrolling the feed.
--
--  * SECURITY DEFINER bypasses RLS, so the shadow-mute filter that
--    posts_select_public (0045) applies has to be restated here by hand.
--    Without it this function would be a hole straight through moderation:
--    a shadow-muted author's posts would reappear in two feeds. The predicate
--    below is a literal copy of that policy's USING clause.
--
-- is_system = false matches the general feed's own filter (see
-- fetchPostsPage): KIVO-authored goal/red-card announcements belong in their
-- fixture's Match Room, not in an unscoped feed.
--
-- Guest-inaccessible by grant: a signed-out visitor has no club and no rival,
-- so there is no version of these feeds for them to ask for.

create or replace function public.get_team_feed_post_ids(
  p_team_id uuid,
  p_offset  int default 0,
  p_limit   int default 20
)
returns table (post_id uuid)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select p.id
  from posts p
  join profiles pr on pr.id = p.author_profile_id
  where pr.favourite_team_id = p_team_id
    and p.is_system = false
    and (
      private.effective_moderation_status_for(p.author_profile_id) is distinct from 'shadow_muted'
      or p.author_profile_id = private.current_profile_id()
      or private.is_admin()
    )
  order by p.created_at desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.get_team_feed_post_ids(uuid, int, int) from public;
grant execute on function public.get_team_feed_post_ids(uuid, int, int) to authenticated;

comment on function public.get_team_feed_post_ids(uuid, int, int) is
  'Posts by profiles whose favourite_team_id is the given club, newest first, for /social''s Club mates and Rivals filters. SECURITY DEFINER because profiles_select_own_or_admin blocks the join; restates posts_select_public''s shadow-mute predicate by hand for the same reason. Returns post ids only — never a roster of who supports what.';


-- To reverse:
--   drop function public.get_team_feed_post_ids(uuid, int, int);
--   drop index if exists idx_profiles_favourite_team;
--   alter table profiles drop constraint profiles_rival_is_not_favourite;
--   alter table profiles drop column rival_team_id;
