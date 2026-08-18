-- =============================================================================
-- Graduated moderation states on profiles (RECOMMENDATIONS.md item 234)
-- =============================================================================
-- Admin previously had zero ban/suspend/role-change surface anywhere in this
-- codebase (no `banned` column, no matching RLS policy in 0001-0043 — see
-- src/app/admin/users/page.tsx's former "read-only by design" note). This is
-- the founder-approved hybrid graduated-state model real platforms
-- (Twitter/X, Reddit, Discord, Twitch) actually use: four states instead of
-- one blunt boolean, each with a distinct real-world meaning and its own
-- real (not client-trusted) enforcement:
--
--   active        - normal, no restriction. Default for every profile.
--   shadow_muted  - the user experiences zero friction (can post/comment/
--                    react exactly as before); their NEW content is silently
--                    invisible to everyone except themselves and admins —
--                    enforced below by narrowing posts_select_public /
--                    comments_select_public, not by anything client-side.
--   suspended     - time-boxed (moderation_expires_at is set). Every one of
--                    the user's own write actions (posting, commenting,
--                    reacting, predicting, rating, polling, saving,
--                    following) is rejected server-side by RLS for the
--                    duration, then reverts to `active` LAZILY — no cron job
--                    anywhere in this codebase by design (see pruneSyncRuns'
--                    own comment for the same constraint) — the moment
--                    anything next reads the user's effective status, via
--                    private.effective_moderation_status() comparing
--                    moderation_expires_at against now().
--   banned        - permanent (moderation_expires_at stays null, enforced by
--                    a check constraint below). Identical write rejection to
--                    suspended, forever. NEVER a hard delete of the profile
--                    or their content — preserves the moderation audit trail
--                    and doesn't destroy replies/reactions other real users
--                    made against a banned user's posts, matching how every
--                    major platform actually handles this.
--
-- moderation_reason/_set_by/_set_at record who acted and why, mirroring
-- moderation_actions' own admin_profile_id/reason shape (0001) so a
-- suspension/ban reads the same way an existing moderation action does. The
-- admin surface itself (src/app/admin/users/actions.ts) additionally writes
-- every action through audit_log (src/lib/audit.ts), same as every other
-- admin action in this codebase.
-- =============================================================================

create type moderation_status as enum ('active', 'shadow_muted', 'suspended', 'banned');

alter table profiles
  add column moderation_status     moderation_status not null default 'active',
  add column moderation_reason     text,
  add column moderation_expires_at timestamptz,
  add column moderation_set_by     uuid references profiles (id) on delete set null,
  add column moderation_set_at     timestamptz;

-- moderation_expires_at is only meaningful for a time-boxed suspension — a
-- permanent ban (or the active/shadow_muted default) must never carry a
-- stale/misleading expiry.
alter table profiles
  add constraint profiles_moderation_expiry_only_when_suspended
  check (moderation_expires_at is null or moderation_status = 'suspended');

-- Suspend/ban require a real reason in the admin UI (enforced there too —
-- see requireModerationReason in src/app/admin/users/actions.ts); this is
-- the same "don't just trust the client" belt-and-suspenders pattern as
-- every RLS check in this file, applied to the reason itself.
alter table profiles
  add constraint profiles_moderation_reason_required_when_restricted
  check (moderation_status not in ('suspended', 'banned') or moderation_reason is not null);

alter table profiles
  add constraint profiles_moderation_reason_length
  check (moderation_reason is null or char_length(moderation_reason) between 1 and 500);

-- Partial: only the (small) set of currently-restricted profiles needs to be
-- fast to find (admin users list "restricted" filter) — the common case
-- (active) shouldn't bloat the index.
create index idx_profiles_moderation_status on profiles (moderation_status)
  where moderation_status <> 'active';


-- -----------------------------------------------------------------------------
-- Lazy-expiry read helpers
-- -----------------------------------------------------------------------------
-- "Lazy" means every *read* of a profile's moderation status is
-- automatically corrected for an elapsed suspension by comparing against
-- now() right here — never a background sweep. Pure computation, no table
-- access, no side effects, so it's safe to call from any RLS USING/WITH
-- CHECK on any table without ever write-locking `profiles`.
create or replace function private.effective_moderation_status(p_status moderation_status, p_expires_at timestamptz)
returns moderation_status
language sql
stable
as $$
  select case
    when p_status = 'suspended' and p_expires_at is not null and p_expires_at <= now()
    then 'active'::moderation_status
    else p_status
  end;
$$;

-- Effective status for an arbitrary profile id (not just the caller) — used
-- by the shadow-mute read filter below, where the row being evaluated
-- belongs to someone other than the caller. SECURITY DEFINER for the same
-- reason as private.current_role(): this needs to work even when called
-- from a policy that is itself gating `profiles`, without recursing into
-- profiles_select_own_or_admin.
create or replace function private.effective_moderation_status_for(p_profile_id uuid)
returns moderation_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.effective_moderation_status(moderation_status, moderation_expires_at)
  from profiles
  where id = p_profile_id;
$$;

-- Caller's own effective status — mirrors private.current_role()'s exact
-- shape, and is what every mutating-table WITH CHECK below calls.
create or replace function private.current_moderation_status()
returns moderation_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.effective_moderation_status(moderation_status, moderation_expires_at)
  from profiles
  where clerk_user_id = private.current_clerk_user_id();
$$;

-- Shared guard: true when the caller is currently (post-lazy-expiry)
-- suspended or banned and must be rejected. A signed-out caller has no
-- profiles row, so current_moderation_status() reads null; `null in (...)`
-- is null, not true, hence the coalesce — a guest is never treated as
-- "blocked" by this guard (they're already blocked by the ordinary
-- ownership check every one of these policies already has).
create or replace function private.is_moderation_write_blocked()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(private.current_moderation_status() in ('suspended', 'banned'), false);
$$;

-- Raw (NOT lazy-expiry-adjusted — deliberately) snapshot of the caller's own
-- 5 moderation columns, bundled as jsonb so the self-tamper guard below can
-- compare all 5 in one shot with plain `=` instead of a row constructor
-- (Postgres's IS DISTINCT FROM does not accept a bare multi-column subquery
-- as a row value the way `=`/`<>` do — jsonb equality sidesteps that
-- entirely). Deliberately raw, not private.current_moderation_status(): an
-- ordinary bio-only self-update must keep comparing against whatever is
-- actually stored right now, even if a suspension's expiry has technically
-- elapsed but nothing has lazily healed the row yet — using the *effective*
-- status here would wrongly reject that harmless edit. SECURITY DEFINER for
-- the same recursion reason as private.current_role(): a raw subquery
-- against `profiles` from inside a policy gating `profiles` itself would
-- recurse into that same policy.
create or replace function private.current_moderation_raw_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'status', moderation_status,
    'reason', moderation_reason,
    'expires_at', moderation_expires_at,
    'set_by', moderation_set_by,
    'set_at', moderation_set_at
  )
  from profiles
  where clerk_user_id = private.current_clerk_user_id();
$$;

grant execute on function private.effective_moderation_status(moderation_status, timestamptz) to authenticated, anon;
grant execute on function private.effective_moderation_status_for(uuid) to authenticated, anon;
grant execute on function private.current_moderation_status() to authenticated, anon;
grant execute on function private.is_moderation_write_blocked() to authenticated, anon;
grant execute on function private.current_moderation_raw_snapshot() to authenticated, anon;


-- -----------------------------------------------------------------------------
-- profiles: lock down self-service moderation-field tampering, guard insert
-- -----------------------------------------------------------------------------
-- Extends 0003's merged profiles_update_own_or_admin exactly the way its own
-- comment describes the role guard: WITH CHECK compares the new row's
-- moderation columns (bundled as jsonb) against current_moderation_raw_snapshot()
-- above, a fresh SECURITY DEFINER read of the CURRENT stored row which
-- (evaluated mid-statement, same idiom as `role = private.current_role()`
-- immediately above it) still reflects the pre-update values. That makes
-- self-service profile edits (bio, avatar, etc.) unable to also silently
-- clear/alter moderation_status or any of its companion columns — only the
-- admin branch may change them. Without this, profiles_update_own_or_admin's
-- existing "own row" USING clause would let a suspended/banned user simply
-- UPDATE their own row back to moderation_status = 'active'.
drop policy profiles_update_own_or_admin on profiles;
create policy profiles_update_own_or_admin on profiles
  for update to authenticated
  using (clerk_user_id = private.current_clerk_user_id() or private.is_admin())
  with check (
    (
      clerk_user_id = private.current_clerk_user_id()
      and role = private.current_role()
      and jsonb_build_object(
            'status', moderation_status,
            'reason', moderation_reason,
            'expires_at', moderation_expires_at,
            'set_by', moderation_set_by,
            'set_at', moderation_set_at
          ) = private.current_moderation_raw_snapshot()
    )
    or private.is_admin()
  );

-- Same reasoning applied to insert: a direct client insert already can't set
-- role away from 'user' (0001's original check); pin moderation_status to
-- the default too so a self-provisioning insert can't arrive pre-restricted
-- or pre-cleared by anything other than the column default.
drop policy profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert to authenticated
  with check (clerk_user_id = private.current_clerk_user_id() and role = 'user' and moderation_status = 'active');


-- -----------------------------------------------------------------------------
-- shadow_muted read filter: posts/comments by a shadow-muted author are
-- visible only to themselves and admins. Additive to the existing "public"
-- policies — a normal (active/suspended/banned) author's content is
-- completely unaffected; compatible as-is with the plain, unfiltered
-- `supabase.from("posts").select(...)` shape both /social and Match Centre
-- already use (src/app/(app)/social/posts.ts), since RLS filters
-- transparently underneath any query shape.
-- -----------------------------------------------------------------------------

drop policy posts_select_public on posts;
create policy posts_select_public on posts
  for select to authenticated, anon
  using (
    private.effective_moderation_status_for(author_profile_id) is distinct from 'shadow_muted'
    or author_profile_id = private.current_profile_id()
    or private.is_admin()
  );

drop policy comments_select_public on comments;
create policy comments_select_public on comments
  for select to authenticated, anon
  using (
    private.effective_moderation_status_for(author_profile_id) is distinct from 'shadow_muted'
    or author_profile_id = private.current_profile_id()
    or private.is_admin()
  );


-- -----------------------------------------------------------------------------
-- suspended/banned write rejection: every user-owned mutating-table policy
-- that lets someone act as themselves gets the same extra
-- `and not private.is_moderation_write_blocked()` clause appended to its
-- WITH CHECK. This is real RLS enforcement, independent of any server
-- action's own client-side or application-layer behavior — it rejects the
-- write at the database itself (SQLSTATE 42501), the same failure mode
-- scripts/verify-rls.sql already exercises for ordinary cross-user writes.
-- -----------------------------------------------------------------------------

drop policy posts_insert_own on posts;
create policy posts_insert_own on posts
  for insert to authenticated
  with check (author_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy posts_update_own on posts;
create policy posts_update_own on posts
  for update to authenticated
  using (author_profile_id = private.current_profile_id())
  with check (author_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy comments_insert_own on comments;
create policy comments_insert_own on comments
  for insert to authenticated
  with check (author_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy comments_update_own on comments;
create policy comments_update_own on comments
  for update to authenticated
  using (author_profile_id = private.current_profile_id())
  with check (author_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy reactions_insert_own on reactions;
create policy reactions_insert_own on reactions
  for insert to authenticated
  with check (profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy predictions_insert_own on predictions;
create policy predictions_insert_own on predictions
  for insert to authenticated
  with check (profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy predictions_update_own_unlocked on predictions;
create policy predictions_update_own_unlocked on predictions
  for update to authenticated
  using (profile_id = private.current_profile_id() and locked_at is null)
  with check (profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy fan_ratings_insert_own on fan_ratings;
create policy fan_ratings_insert_own on fan_ratings
  for insert to authenticated
  with check (
    profile_id = private.current_profile_id()
    and not private.is_moderation_write_blocked()
    and exists (select 1 from fixtures f where f.id = fixture_id and f.status = 'finished')
  );

drop policy fan_ratings_update_own on fan_ratings;
create policy fan_ratings_update_own on fan_ratings
  for update to authenticated
  using (profile_id = private.current_profile_id())
  with check (profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy poll_options_insert_own_post on poll_options;
create policy poll_options_insert_own_post on poll_options
  for insert to authenticated
  with check (
    not private.is_moderation_write_blocked()
    and exists (
      select 1 from posts
      where posts.id = post_id and posts.author_profile_id = private.current_profile_id()
    )
  );

drop policy poll_votes_insert_own on poll_votes;
create policy poll_votes_insert_own on poll_votes
  for insert to authenticated
  with check (profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy saves_insert_own on saves;
create policy saves_insert_own on saves
  for insert to authenticated
  with check (profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

drop policy follows_insert_own on follows;
create policy follows_insert_own on follows
  for insert to authenticated
  with check (follower_profile_id = private.current_profile_id() and not private.is_moderation_write_blocked());

-- To reverse: drop the policies re-created above and restore each one's pre-
-- this-migration definition (posts_select_public/comments_select_public back
-- to `using (true)`; every *_insert_own/*_update_own above drop their
-- trailing `and not private.is_moderation_write_blocked()`;
-- profiles_update_own_or_admin/profiles_insert_own drop their moderation-
-- column clauses — see 0001/0003/0032 for each policy's original text);
-- drop function private.is_moderation_write_blocked(),
-- private.current_moderation_raw_snapshot(),
-- private.current_moderation_status(),
-- private.effective_moderation_status_for(uuid),
-- private.effective_moderation_status(moderation_status, timestamptz); drop
-- index idx_profiles_moderation_status; alter table profiles drop constraint
-- profiles_moderation_reason_length, drop constraint
-- profiles_moderation_reason_required_when_restricted, drop constraint
-- profiles_moderation_expiry_only_when_suspended, drop column
-- moderation_set_at, drop column moderation_set_by, drop column
-- moderation_expires_at, drop column moderation_reason, drop column
-- moderation_status; drop type moderation_status.
