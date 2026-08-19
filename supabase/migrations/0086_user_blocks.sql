-- =============================================================================
-- blocks: the self-service half of moderation
-- =============================================================================
-- KIVO has real moderation — 0045's graduated active/shadow_muted/suspended/
-- banned ladder, enforced in RLS rather than trusted from a client. Every bit
-- of it is something an *admin* does. A user who simply does not want to read
-- one other person has had, until now, exactly one option: report them and
-- wait for a human.
--
-- The founding brief lists "report/block/mute" together as one social-safety
-- feature. Two of the three exist. This is the third.
--
-- SHAPE. Exactly the ownership pattern `saves` (0032) and `follows` (0001)
-- already establish: one row per (owner, target), owner-scoped RLS, no update
-- policy because a block has no state to change — you hold it or you release
-- it. Nothing new to learn, and the same pattern a reviewer has already read.
--
-- RECIPROCAL IN VISIBILITY, ONE-SIDED IN OWNERSHIP. If A blocks B, neither
-- sees the other's posts or comments. That is not symmetry for its own sake:
-- a block that only hides B from A leaves A's own words sitting in front of
-- the person they just walked away from, which is the opposite of what the
-- action means. The *row* is still A's alone — B cannot see it, cannot list
-- it, and cannot remove it.
--
-- AND IT MUST NOT ANNOUNCE ITSELF. Nothing anywhere tells B a block exists.
-- The content is simply not in B's result sets, exactly as though it had been
-- deleted, and every write B attempts against A fails the same generic way an
-- ordinary permission failure does. `blocks_select_own` is what makes that
-- true at the database level rather than in a server action somebody could
-- one day forget to call.

create table if not exists blocks (
  id                  uuid primary key default gen_random_uuid(),
  blocker_profile_id  uuid not null references profiles (id) on delete cascade,
  blocked_profile_id  uuid not null references profiles (id) on delete cascade,
  created_at          timestamptz not null default now(),
  constraint blocks_unique unique (blocker_profile_id, blocked_profile_id),
  -- Blocking yourself would make your own posts invisible to you, which is a
  -- confusing bug report rather than a feature.
  constraint blocks_not_self check (blocker_profile_id <> blocked_profile_id)
);

-- Both directions are read on every feed query (the relationship is symmetric
-- for visibility), so both directions get an index.
create index if not exists idx_blocks_blocker on blocks (blocker_profile_id);
create index if not exists idx_blocks_blocked on blocks (blocked_profile_id);

alter table blocks enable row level security;

-- Only the person who made the block can see it. This is the non-leak
-- guarantee: there is no query B can run, through PostgREST or otherwise,
-- that distinguishes "A blocked me" from "A has no posts".
drop policy if exists blocks_select_own on blocks;
create policy blocks_select_own on blocks
  for select to authenticated
  using (blocker_profile_id = private.current_profile_id());

drop policy if exists blocks_insert_own on blocks;
create policy blocks_insert_own on blocks
  for insert to authenticated
  with check (blocker_profile_id = private.current_profile_id());

drop policy if exists blocks_delete_own on blocks;
create policy blocks_delete_own on blocks
  for delete to authenticated
  using (blocker_profile_id = private.current_profile_id());

-- Deliberately no UPDATE policy: a block row has no mutable field. Unblocking
-- is a delete, which is also what makes "unblock" genuinely leave no trace.

comment on table blocks is
  'Self-service user blocks, distinct from admin moderation (0045). Visibility is reciprocal — neither party sees the other''s posts or comments — but the row belongs to the blocker alone and is invisible to the blocked party, so a block can never be detected by the person it applies to.';

-- -----------------------------------------------------------------------------
-- The one function every read path goes through
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER because it is called from inside RLS policies on `posts`
-- and `comments`: a policy expression that read `blocks` directly would be
-- subject to `blocks_select_own` itself and could therefore only ever see one
-- half of the relationship — the half that hides the blocked party's content
-- from the blocker, and not the half that hides the blocker's content from
-- the blocked party. Same reasoning, and same shape, as 0045's
-- `private.effective_moderation_status_for`.
--
-- Returns an array rather than taking a target id, and is STABLE with no
-- arguments, so Postgres evaluates it once per statement and the per-row cost
-- is an array membership test rather than a subquery. On a feed page that is
-- one small query instead of one per post.
--
-- COALESCE is load-bearing, not defensive noise: `array_agg` over zero rows
-- returns NULL, and `x <> all(NULL)` is NULL, which RLS reads as false. A user
-- who has never blocked anyone would see an empty feed.
create or replace function private.blocked_profile_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    array_agg(other_id),
    '{}'::uuid[]
  )
  from (
    select blocked_profile_id as other_id
    from blocks
    where blocker_profile_id = private.current_profile_id()
    union
    select blocker_profile_id as other_id
    from blocks
    where blocked_profile_id = private.current_profile_id()
  ) both_directions;
$$;

revoke execute on function private.blocked_profile_ids() from public;
grant execute on function private.blocked_profile_ids() to authenticated, anon;

-- -----------------------------------------------------------------------------
-- Read filters
-- -----------------------------------------------------------------------------
-- Recreated in full rather than patched, so the whole policy is readable in
-- one place — the moderation half below the `and` is byte-identical to what
-- 0045 left here.
--
-- Deliberately NO admin bypass on the block half. 0045's `private.is_admin()`
-- escape hatch exists so a moderator can still see shadow-muted content they
-- are being asked to judge; a personal block is not a moderation question, and
-- an admin quietly still seeing someone they personally blocked would be a
-- surprise rather than a capability. Moderation surfaces do not depend on this
-- path anyway: `reports` carries its own content snapshot (0022), and the
-- admin queues run under the service-role client, which bypasses RLS entirely.
drop policy if exists posts_select_public on posts;
create policy posts_select_public on posts
  for select to authenticated, anon
  using (
    (
      private.effective_moderation_status_for(author_profile_id) is distinct from 'shadow_muted'
      or author_profile_id = private.current_profile_id()
      or private.is_admin()
    )
    and author_profile_id <> all (private.blocked_profile_ids())
  );

drop policy if exists comments_select_public on comments;
create policy comments_select_public on comments
  for select to authenticated, anon
  using (
    (
      private.effective_moderation_status_for(author_profile_id) is distinct from 'shadow_muted'
      or author_profile_id = private.current_profile_id()
      or private.is_admin()
    )
    and author_profile_id <> all (private.blocked_profile_ids())
  );

-- -----------------------------------------------------------------------------
-- A block severs the follow graph, in both directions
-- -----------------------------------------------------------------------------
-- Without this, blocking someone leaves them following you — so your posts
-- keep reaching their feed query even though the read filter hides them, and
-- your follower count keeps counting a person who is, as far as the product is
-- concerned, no longer there. Worse, unblocking would silently restore a
-- relationship the user had already walked away from.
--
-- A trigger rather than a server action, for the same reason the read filter
-- is a policy: it must hold for any writer, including a direct PostgREST
-- insert.
create or replace function private.sever_follows_on_block()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from follows
  where followed_type = 'user'
    and (
      (follower_profile_id = new.blocker_profile_id and followed_id = new.blocked_profile_id)
      or (follower_profile_id = new.blocked_profile_id and followed_id = new.blocker_profile_id)
    );
  return new;
end;
$$;

revoke execute on function private.sever_follows_on_block() from public;

drop trigger if exists trg_blocks_sever_follows on blocks;
create trigger trg_blocks_sever_follows after insert on blocks
  for each row execute function private.sever_follows_on_block();

-- And no new follow can be created across a block. Recreated in full; the
-- moderation clause is exactly as 0045 left it.
drop policy if exists follows_insert_own on follows;
create policy follows_insert_own on follows
  for insert to authenticated
  with check (
    follower_profile_id = private.current_profile_id()
    and not private.is_moderation_write_blocked()
    and (
      followed_type <> 'user'
      or followed_id <> all (private.blocked_profile_ids())
    )
  );

-- To reverse:
--   drop policy follows_insert_own on follows; (recreate as 0045 left it)
--   drop trigger if exists trg_blocks_sever_follows on blocks;
--   drop function if exists private.sever_follows_on_block();
--   drop policy posts_select_public on posts; (recreate as 0045 left it)
--   drop policy comments_select_public on comments; (same)
--   drop function if exists private.blocked_profile_ids();
--   drop table blocks;
