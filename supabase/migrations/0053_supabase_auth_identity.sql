-- =============================================================================
-- 0053 — Move RLS identity from Clerk to Supabase Auth
-- =============================================================================
--
-- WHY
-- ---
-- KIVO's sign-up/sign-in ran on Clerk, with Supabase reading identity out of a
-- Clerk-issued JWT (`auth.jwt() ->> 'sub'`). That flow could not be made to
-- work reliably in production, so auth moves to Supabase Auth itself. With
-- Supabase Auth the caller's identity is `auth.uid()` — a real uuid pointing
-- at `auth.users` — and no third-party JWKS verification is involved at all.
--
-- WHY THIS IS SMALL
-- -----------------
-- Every RLS policy in this schema resolves identity through the indirection
-- helpers in the `private` schema (private.current_profile_id(),
-- private.current_role(), private.is_admin(), ...) rather than touching
-- `clerk_user_id` directly. Confirmed live against pg_policies/pg_proc before
-- writing this: exactly SIX policies and FOUR functions mention
-- private.current_clerk_user_id() or the clerk_user_id column —
--
--   public.profiles          : profiles_select_own_or_admin,
--                              profiles_insert_own,
--                              profiles_update_own_or_admin
--   storage.objects          : avatars_select/insert/update/delete_own (3 of 4;
--                              avatars_select_public never referenced identity)
--   private.current_profile_id(), private.current_role(),
--   private.current_moderation_status(),
--   private.current_moderation_raw_snapshot()
--
-- — so the ~50 other policies across the schema keep working untouched, because
-- the thing they call now resolves the same profile id from a different
-- identity source. Nothing below widens what any policy accepts.
--
-- WHAT IS DELIBERATELY *NOT* DONE
-- --------------------------------
-- `profiles.clerk_user_id` is NOT dropped. There is real user data in it (4 of
-- the 5 rows currently in `profiles` carry a genuine Clerk id, and
-- `kivo_system` carries the 0047 sentinel). It only becomes nullable and
-- unreferenced here; deciding whether those rows get relinked to new
-- auth.users rows or discarded is a separate, destructive decision that must
-- not ride along with the auth swap.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. profiles: the new identity column
-- -----------------------------------------------------------------------------
-- `on delete cascade` mirrors what the Clerk webhook's user.deleted handler
-- used to do by hand: deleting the auth user takes the profile (and, via the
-- existing profile_id FKs, everything owned by it) with it.
alter table profiles
  add column if not exists auth_user_id uuid unique references auth.users (id) on delete cascade;

comment on column profiles.auth_user_id is
  'Supabase Auth user (auth.users.id). THE identity column — every RLS policy resolves the caller through this via private.current_profile_id(). Null only for rows that predate the Clerk-to-Supabase-Auth migration and for the kivo_system account, which never authenticates.';

-- Clerk-era rows keep their id; new Supabase-Auth rows have nothing to put here.
alter table profiles alter column clerk_user_id drop not null;

comment on column profiles.clerk_user_id is
  'LEGACY. Clerk user id from before auth moved to Supabase Auth (migration 0053). No policy, function, or application code reads this any more — it is retained only so pre-migration rows can still be identified/relinked. Null on every profile created after 0053.';


-- -----------------------------------------------------------------------------
-- 2. The identity indirection helpers
-- -----------------------------------------------------------------------------
-- Same shape, same SECURITY DEFINER rationale as 0001 (a policy on `profiles`
-- that needs to read `profiles` would otherwise recurse into itself and raise
-- "infinite recursion detected in policy"), same pinned search_path. The only
-- change is the WHERE clause: `clerk_user_id = <clerk jwt sub>` becomes
-- `auth_user_id = auth.uid()`.
--
-- auth.uid() is null for an anonymous caller, and `auth_user_id = null` matches
-- no rows (null comparison, not an error), so each of these still returns null
-- for a signed-out caller exactly as before.

create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from profiles where auth_user_id = auth.uid();
$$;

create or replace function private.current_role()
returns user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from profiles where auth_user_id = auth.uid();
$$;

-- From 0045. Effective (lazy-expiry-adjusted) moderation status of the caller.
create or replace function private.current_moderation_status()
returns moderation_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.effective_moderation_status(moderation_status, moderation_expires_at)
  from profiles
  where auth_user_id = auth.uid();
$$;

-- From 0045. Raw (deliberately NOT expiry-adjusted) snapshot of the caller's
-- own moderation columns, used by the profiles UPDATE self-tamper guard below.
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
  where auth_user_id = auth.uid();
$$;


-- -----------------------------------------------------------------------------
-- 3. profiles policies
-- -----------------------------------------------------------------------------
-- Each is recreated with the identical shape it had after 0003 + 0045 — the
-- merged own-or-admin SELECT/UPDATE, the role-cannot-change guard, the
-- moderation self-tamper guard, the pinned role/moderation_status on INSERT.
-- The ONLY edit in each is `clerk_user_id = private.current_clerk_user_id()`
-- becoming `auth_user_id = auth.uid()`.

drop policy if exists profiles_select_own_or_admin on profiles;
create policy profiles_select_own_or_admin on profiles
  for select to authenticated
  using (auth_user_id = auth.uid() or private.is_admin());

-- Unlike the Clerk build, this INSERT path is now load-bearing rather than
-- defense-in-depth: there is no webhook provisioning profiles any more, so
-- getOrCreateProfile() (src/lib/profile.ts) inserts the caller's own row
-- through this policy with the caller's own session. WITH CHECK still pins
-- role and moderation_status so nobody can self-provision as an admin or
-- arrive pre-restricted/pre-cleared.
drop policy if exists profiles_insert_own on profiles;
create policy profiles_insert_own on profiles
  for insert to authenticated
  with check (auth_user_id = auth.uid() and role = 'user' and moderation_status = 'active');

drop policy if exists profiles_update_own_or_admin on profiles;
create policy profiles_update_own_or_admin on profiles
  for update to authenticated
  using (auth_user_id = auth.uid() or private.is_admin())
  with check (
    (
      auth_user_id = auth.uid()
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


-- -----------------------------------------------------------------------------
-- 4. avatars storage policies
-- -----------------------------------------------------------------------------
-- 0043 stores uploads at `<clerk_user_id>/<filename>` so ownership is a folder
-- name comparison with no join. Same layout, new key: `<auth.users.id>/...`.
-- src/app/(app)/settings/avatar-actions.ts builds the path from
-- profile.auth_user_id to match.
--
-- Consequence, stated plainly: an upload made by a Clerk-era user before this
-- migration sits under their old Clerk id and can no longer be updated or
-- deleted by them through these policies. It is still publicly readable
-- (avatars_select_public is unchanged and never referenced identity), so no
-- existing avatar_uploaded_url breaks. Those users cannot sign in with their
-- old identity at all after this migration, so there is no session that could
-- have exercised the write policies on that folder anyway.

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);


-- -----------------------------------------------------------------------------
-- 5. Retire the Clerk identity helper
-- -----------------------------------------------------------------------------
-- Nothing references it after sections 2-4. Left in place it would be a live
-- footgun: it reads `auth.jwt() ->> 'sub'`, which under Supabase Auth is the
-- auth.users uuid, so a future policy written against it would silently
-- compare a uuid to the legacy text column and match nothing.
drop function if exists private.current_clerk_user_id();


-- =============================================================================
-- To reverse
-- =============================================================================
-- 1. Recreate private.current_clerk_user_id() exactly as 0001 + 0002 left it
--    (`select nullif(auth.jwt() ->> 'sub', '')`, search_path pinned).
-- 2. Recreate the four private.* functions in section 2 with
--    `where clerk_user_id = private.current_clerk_user_id()`.
-- 3. Recreate the three profiles policies and three avatars policies with
--    `clerk_user_id = private.current_clerk_user_id()` /
--    `(storage.foldername(name))[1] = private.current_clerk_user_id()`.
-- 4. `alter table profiles alter column clerk_user_id set not null` (only
--    possible once every row has one again) and
--    `alter table profiles drop column auth_user_id`.
