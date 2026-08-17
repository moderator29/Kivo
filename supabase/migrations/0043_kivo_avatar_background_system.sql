-- KIVO avatar/background/match-share-card asset system (RECOMMENDATIONS.md
-- items 231/232 track the assets themselves; this wires the schema on top of
-- the confirmed-clean subset already committed under public/assets/kivo/).
--
-- Only 5 of 18 avatars (06/08/11/12/17) and 10 of 12 backgrounds
-- (01/02/04/05/07-12) survived asset QA — the rest need a remastered source
-- (items 231/232) and must never be offered by the picker or referenced by a
-- profile row. The check constraints below enforce that at the database
-- layer too, not just in the picker UI: the confirmed-clean id lists here
-- are hand-kept in sync with KIVO_AVATAR_IDS/KIVO_BACKGROUND_IDS in
-- src/lib/kivo-assets.ts (same "duplicated literal, kept in sync by hand"
-- precedent as MAX_BIO_LENGTH in settings/actions.ts).

-- =============================================================================
-- 1. Columns
-- =============================================================================

create type avatar_type as enum ('kivo', 'uploaded');

alter table profiles
  add column avatar_type          avatar_type not null default 'kivo',
  add column avatar_kivo_id       text,
  add column avatar_uploaded_url  text,
  add column background_id       text;

alter table profiles
  add constraint profiles_avatar_type_fields_match check (
    (avatar_type = 'kivo' and avatar_uploaded_url is null)
    or
    (avatar_type = 'uploaded' and avatar_kivo_id is null)
  ),
  add constraint profiles_avatar_kivo_id_confirmed_clean check (
    avatar_kivo_id is null or avatar_kivo_id in (
      'kivo-avatar-06', 'kivo-avatar-08', 'kivo-avatar-11', 'kivo-avatar-12', 'kivo-avatar-17'
    )
  ),
  add constraint profiles_background_id_confirmed_clean check (
    background_id is null or background_id in (
      'kivo-bg-01', 'kivo-bg-02', 'kivo-bg-04', 'kivo-bg-05',
      'kivo-bg-07', 'kivo-bg-08', 'kivo-bg-09', 'kivo-bg-10', 'kivo-bg-11', 'kivo-bg-12'
    )
  );

-- Backfill: at the time of this migration there is exactly one real profile
-- row (checked live via execute_sql before writing this) and it predates
-- this feature, so it has no avatar_kivo_id yet despite avatar_type
-- defaulting to 'kivo' above. Assign it one of the confirmed-clean ids the
-- same way a brand-new signup would (random, uniform) rather than leaving a
-- profile with avatar_type='kivo' and a null avatar_kivo_id — see Part 2 of
-- this feature for the application-side version of this same assignment.
update profiles
set avatar_kivo_id = (
  array['kivo-avatar-06', 'kivo-avatar-08', 'kivo-avatar-11', 'kivo-avatar-12', 'kivo-avatar-17']
)[1 + floor(random() * 5)::int]
where avatar_type = 'kivo' and avatar_kivo_id is null and avatar_uploaded_url is null;

-- =============================================================================
-- 2. Public-identity RPCs: teach both about the new avatar fields
-- =============================================================================
-- get_public_profiles/get_public_profile_by_username return the columns a
-- caller needs to resolve the REAL active avatar client-side (avatar_type +
-- avatar_kivo_id for the 'kivo' case, avatar_uploaded_url for the 'uploaded'
-- case) plus the legacy avatar_url as the pre-feature fallback — see
-- resolveAvatarSrc() in src/lib/kivo-assets.ts. Postgres can't
-- CREATE OR REPLACE a set-returning function across a changed return shape,
-- so both are dropped and recreated; grants are reapplied identically to
-- 0011/0014.

drop function if exists public.get_public_profiles(uuid[]);

create or replace function public.get_public_profiles(p_ids uuid[])
returns table (
  id                  uuid,
  username            text,
  display_name        text,
  avatar_url          text,
  avatar_type         avatar_type,
  avatar_kivo_id      text,
  avatar_uploaded_url text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select id, username, display_name, avatar_url, avatar_type, avatar_kivo_id, avatar_uploaded_url
  from profiles
  where id = any(p_ids);
$$;

revoke execute on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to anon, authenticated;

drop function if exists public.get_public_profile_by_username(text);

create or replace function public.get_public_profile_by_username(p_username text)
returns table (
  id                  uuid,
  username            text,
  display_name        text,
  avatar_url          text,
  avatar_type         avatar_type,
  avatar_kivo_id      text,
  avatar_uploaded_url text,
  background_id       text
)
language sql
security definer
set search_path = public, extensions, pg_temp
stable
as $$
  select id, username, display_name, avatar_url, avatar_type, avatar_kivo_id, avatar_uploaded_url, background_id
  from profiles
  where username = p_username::citext;
$$;

revoke execute on function public.get_public_profile_by_username(text) from public;
grant execute on function public.get_public_profile_by_username(text) to anon, authenticated;

-- =============================================================================
-- 3. Storage bucket for user-uploaded avatars
-- =============================================================================
-- No bucket existed anywhere in this project before this feature (checked
-- storage.buckets live — empty). Objects are stored at
-- `<clerk_user_id>/<filename>` so ownership can be checked with the same
-- private.current_clerk_user_id() helper every other RLS policy in this
-- schema already uses, without a second join back to profiles.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy avatars_select_public on storage.objects
  for select to public
  using (bucket_id = 'avatars');

create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = private.current_clerk_user_id());

create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = private.current_clerk_user_id())
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = private.current_clerk_user_id());

create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = private.current_clerk_user_id());

-- To reverse: drop the four avatars_* storage.objects policies, delete from
-- storage.buckets where id = 'avatars', restore get_public_profiles/
-- get_public_profile_by_username to their 0011/0014 shapes, drop the three
-- check constraints and four columns added above, and drop type avatar_type.
