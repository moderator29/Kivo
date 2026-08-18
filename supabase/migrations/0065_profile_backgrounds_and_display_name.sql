-- =============================================================================
-- 0065 — Let a profile carry its own cover image, and its own name
-- =============================================================================
-- Part of the profile rebuild. Two gaps, both visible the moment a real person
-- signs up and opens /profile:
--
--  1. `background_id` can only ever hold one of the ten confirmed-clean KIVO
--     background ids (0043's `profiles_background_id_confirmed_clean`). The
--     avatar half of that same feature already lets a user upload their own
--     photo (`avatar_uploaded_url`, the `avatars` Storage bucket, and
--     `uploadAvatar` in src/app/(app)/settings/avatar-actions.ts). The cover
--     image had no equivalent, so "use your own picture" was answerable for the
--     small circle and not for the large banner behind it.
--
--  2. `display_name` is nullable text with no constraint and — until this
--     change's UI half — no writer at all. `resolveViewerProfile`
--     (src/lib/profile.ts) deliberately inserts null rather than deriving a
--     name from the email local-part, and nothing since ever set it, so every
--     account created under Supabase Auth renders as its generated
--     `user_xxxxxxxxxx` handle and nothing else.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not add a `background_type` enum mirroring `avatar_type`. The two
-- are not the same shape: an avatar always exists (a KIVO one is assigned at
-- profile creation), so an enum there has no "neither" case to express. A
-- background is genuinely optional and always has been — no default is ever
-- forced (see `clearBackground` in profile/background-actions.ts) — so "none"
-- has to be representable, and two nullable columns with an exclusivity check
-- says that in one fewer type. `resolveBackgroundSrc()` in
-- src/lib/kivo-assets.ts is the single reader, mirroring `resolveAvatarSrc()`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. profiles.background_uploaded_url
-- -----------------------------------------------------------------------------

alter table profiles
  add column background_uploaded_url text;

-- Exactly one source at a time, or neither. Without this a row could hold both
-- a KIVO id and an upload, and every reader would have to invent a precedence
-- rule of its own — the same failure `profiles_avatar_type_fields_match`
-- prevents on the avatar side.
alter table profiles
  add constraint profiles_background_source_exclusive check (
    background_id is null or background_uploaded_url is null
  );

comment on column profiles.background_uploaded_url is
  'Public URL of a cover image the user uploaded themselves, in the `backgrounds` Storage bucket at <auth_user_id>/<timestamp>.<ext>. Mutually exclusive with background_id (the ten confirmed-clean KIVO covers) via profiles_background_source_exclusive; both null means no cover, which is the default and is never overridden. Read through resolveBackgroundSrc() in src/lib/kivo-assets.ts.';


-- -----------------------------------------------------------------------------
-- 2. profiles.display_name gets a real shape
-- -----------------------------------------------------------------------------
-- Bounded the same way `bio` has been since 0001, and for the same reason: the
-- column is rendered as a heading on /profile, /u/[username], every post, every
-- comment and the account menu, and an unbounded string there is a layout
-- weapon. 40 is the visible-name cap X and Instagram both settled on.
--
-- Empty string is rejected as well as over-long: the editor writes null for a
-- cleared field, and a row holding '' would render as a nameless heading that
-- the "fall back to @username" path never catches.
--
-- Verified against the live project before writing: two profile rows, one with
-- display_name null and one with 'KIVO' — both already satisfy this.
alter table profiles
  add constraint profiles_display_name_length check (
    display_name is null or char_length(display_name) between 1 and 40
  );


-- -----------------------------------------------------------------------------
-- 3. Storage bucket for user-uploaded covers
-- -----------------------------------------------------------------------------
-- Deliberately a second bucket rather than a folder inside `avatars`: the
-- `avatars` bucket's ownership policies key off the FIRST path segment
-- (`(storage.foldername(name))[1] = auth.uid()::text`, 0053), so a
-- `<uid>/backgrounds/...` layout would still be owned correctly but a
-- `backgrounds/<uid>/...` one would not — and the per-bucket
-- `file_size_limit`/`allowed_mime_types` are the only place a cover's limits
-- can differ from an avatar's later. Same shape, same policies, same public
-- read (these are served straight to <img> tags, exactly like avatars — see
-- 0059's note on why `avatars_select_public` survived that migration).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backgrounds', 'backgrounds', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy backgrounds_select_public on storage.objects
  for select to public
  using (bucket_id = 'backgrounds');

create policy backgrounds_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy backgrounds_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy backgrounds_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);


-- -----------------------------------------------------------------------------
-- 4. get_public_profile_by_username: the three fields the rebuilt header needs
-- -----------------------------------------------------------------------------
-- /profile and /u/[username] now render the SAME header component
-- (src/components/profile/profile-header.tsx). /profile reads the caller's own
-- row directly; /u/[username] can only see another profile through this RPC
-- (there is no cross-user SELECT policy on `profiles`), so anything the header
-- shows has to come back from here or the two surfaces silently diverge.
--
-- Three additions, each already public information on this product:
--   * background_uploaded_url — the other half of section 1 above; without it
--     an uploaded cover renders for its owner and vanishes for everyone else.
--   * created_at             — the "Joined <month> <year>" line. Standard on
--     every social profile, and it is the account's own creation date, not
--     anyone else's data.
--   * favourite_team_id      — the club the profile supports. This is a
--     football product; the club is the point of the profile, and the name is
--     resolved by the caller from `teams`, which is already readable by any
--     authenticated user.
--
-- Not covered by `show_activity_publicly` (0048): that flag gates XP and badges
-- — earned activity — through get_public_profile_stats. Identity fields
-- (username, display name, avatar, bio, country) have always been returned by
-- this function regardless of it, and a cover image, a join date and a club
-- badge are identity, not activity. Anyone who wants none of them shown simply
-- sets none of them.
--
-- Recreated rather than replaced: Postgres cannot CREATE OR REPLACE a
-- set-returning function across a changed return shape. Grants are reapplied
-- exactly as 0048 left them and 0059 narrowed them — `authenticated` only, no
-- `anon`.

drop function if exists public.get_public_profile_by_username(text);

create or replace function public.get_public_profile_by_username(p_username text)
returns table (
  id                     uuid,
  username               text,
  display_name           text,
  avatar_url             text,
  avatar_type            avatar_type,
  avatar_kivo_id         text,
  avatar_uploaded_url    text,
  background_id          text,
  background_uploaded_url text,
  bio                    text,
  country                text,
  favourite_team_id      uuid,
  created_at             timestamptz
)
language sql
security definer
-- citext (and its cross-type = operator against text) lives in the
-- `extensions` schema, not `public` — unchanged from 0014/0043/0048.
set search_path = public, extensions, pg_temp
stable
as $$
  select id, username, display_name, avatar_url, avatar_type, avatar_kivo_id, avatar_uploaded_url,
         background_id, background_uploaded_url, bio, country, favourite_team_id, created_at
  from profiles
  where username = p_username::citext;
$$;

revoke execute on function public.get_public_profile_by_username(text) from public;
revoke execute on function public.get_public_profile_by_username(text) from anon;
grant execute on function public.get_public_profile_by_username(text) to authenticated;


-- =============================================================================
-- To reverse
-- =============================================================================
--   * restore get_public_profile_by_username to its 0048 shape (drop
--     background_uploaded_url, favourite_team_id and created_at from both the
--     RETURNS TABLE and the SELECT), reapplying the same grants;
--   * drop the four backgrounds_* policies on storage.objects and
--     `delete from storage.buckets where id = 'backgrounds'` (after emptying
--     it — Storage refuses to drop a bucket with objects in it, and an auth
--     user who still owns objects cannot be deleted, which is why
--     `deleteAccount` in src/app/(app)/settings/actions.ts sweeps this bucket
--     alongside `avatars`);
--   * drop constraint profiles_display_name_length;
--   * drop constraint profiles_background_source_exclusive and column
--     profiles.background_uploaded_url.
-- =============================================================================
