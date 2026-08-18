-- =============================================================================
-- Public-profile privacy, bio/country, and a real followers read
-- (RECOMMENDATIONS.md section 20, items 286/290/291)
-- =============================================================================
-- Bundled into one migration because all three touch the exact same public-
-- profile RPC surface (get_public_profile_stats / get_public_profile_by_username)
-- and this branch has already hit two migration-numbering collisions tonight —
-- one new file instead of three shrinks that surface area.
--
-- 286: profiles has no visibility/privacy column at all (grepped every
-- `alter table profiles` across 0001-0047 — only avatar/background (0043) and
-- moderation (0045) ever touched it) and get_public_profile_stats returns a
-- profile's full summed XP and complete badge list to *any* caller, anon
-- included, with no opt-out. show_activity_publicly is the real opt-out,
-- defaulting true so nothing changes for anyone who never touches it.
--
-- 290: profiles.bio/country are captured by ProfileDetailsEditor and rendered
-- nowhere. get_public_profile_by_username gets both added to its return
-- columns for /u/[username] — deliberately NOT gated by show_activity_publicly,
-- per the recommendation's own framing: bio/country are lower-sensitivity than
-- XP/badges and ship independent of that toggle.
--
-- 291: /profile/following can already read "who this profile follows" with a
-- plain query (follows_select_own's `follower_profile_id = current_profile_id()`
-- already covers that direction), but "who follows them" needs
-- `followed_id = current_profile_id()` — a direction follows_select_own does
-- NOT cover (checked directly: exactly one SELECT policy exists on `follows`,
-- scoped to the follower side only, unchanged since 0001). A plain client
-- query for the reverse direction would silently return zero rows forever,
-- not an error — a quiet-wrong-data bug, not a working feature.
-- get_my_followers() is the narrow SECURITY DEFINER read that direction
-- actually needs, shaped like the RLS-boundary-crossing RPCs this codebase
-- already established (get_public_profile_stats over xp_ledger/user_badges,
-- redeem_invite_code's own private.current_profile_id() lookup) — deliberately
-- zero-argument so it can only ever answer "who follows ME," never "who
-- follows this other profile," which nothing in this recommendation asked for.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. profiles.show_activity_publicly (item 286)
-- -----------------------------------------------------------------------------

alter table profiles
  add column show_activity_publicly boolean not null default true;

comment on column profiles.show_activity_publicly is 'RECOMMENDATIONS.md item 286: when false, get_public_profile_stats() returns is_public = false with total_xp/badges zeroed, and /u/[username] renders an honest "keeps their activity private" state instead of a bare zero. Owner-editable via the existing profiles_update_own_or_admin policy (same as bio/country) — no RLS change needed for the column itself.';

-- No policy change needed: profiles_update_own_or_admin (0045) already lets
-- the owner update any non-role/non-moderation column on their own row,
-- exactly the same path bio/country already use via updateProfileDetails.


-- -----------------------------------------------------------------------------
-- 2. get_public_profile_stats: respect the flag, expose is_public (item 286)
-- -----------------------------------------------------------------------------
-- Adds `is_public` so a caller can tell "opted out" (is_public = false,
-- total_xp/badges always 0/[]) apart from "opted in but genuinely has 0 XP /
-- no badges yet" (is_public = true, totals real) — the exact distinction
-- /u/[username] needs to avoid a privacy-on profile silently reading as
-- "hasn't earned anything." Postgres can't CREATE OR REPLACE a set-returning
-- function across a changed return shape (same constraint 0043 hit for this
-- exact function), so it's dropped and recreated, same as that migration did.

drop function if exists public.get_public_profile_stats(uuid);

create or replace function public.get_public_profile_stats(p_profile_id uuid)
returns table (
  total_xp  bigint,
  badges    jsonb,
  is_public boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    case when coalesce((select show_activity_publicly from profiles where id = p_profile_id), true)
      then coalesce((select sum(amount) from xp_ledger where profile_id = p_profile_id), 0)::bigint
      else 0::bigint
    end as total_xp,
    case when coalesce((select show_activity_publicly from profiles where id = p_profile_id), true)
      then coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'code', b.code,
              'name', b.name,
              'description', b.description,
              'icon_url', b.icon_url,
              'awarded_at', ub.awarded_at
            )
            order by ub.awarded_at asc
          )
          from user_badges ub
          join badges b on b.id = ub.badge_id
          where ub.profile_id = p_profile_id
        ),
        '[]'::jsonb
      )
      else '[]'::jsonb
    end as badges,
    coalesce((select show_activity_publicly from profiles where id = p_profile_id), true) as is_public;
$$;

revoke execute on function public.get_public_profile_stats(uuid) from public;
grant execute on function public.get_public_profile_stats(uuid) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 3. get_public_profile_by_username: add bio/country (item 290)
-- -----------------------------------------------------------------------------

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
  background_id       text,
  bio                 text,
  country             text
)
language sql
security definer
-- citext (and its cross-type = operator against text) lives in the
-- `extensions` schema, not `public` — unchanged from 0014/0043.
set search_path = public, extensions, pg_temp
stable
as $$
  select id, username, display_name, avatar_url, avatar_type, avatar_kivo_id, avatar_uploaded_url,
         background_id, bio, country
  from profiles
  where username = p_username::citext;
$$;

revoke execute on function public.get_public_profile_by_username(text) from public;
grant execute on function public.get_public_profile_by_username(text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. get_my_followers(): the real "who follows them" read (item 291)
-- -----------------------------------------------------------------------------
-- "Who this profile follows" is already answerable with a plain client query
-- (follows_select_own covers `follower_profile_id = current_profile_id()`).
-- The reverse direction has no covering SELECT policy, so this is a narrow,
-- deliberately zero-argument SECURITY DEFINER read scoped to the caller's own
-- incoming 'user'-type follows only — it cannot be pointed at any other
-- profile's followers, because it never accepts a profile id at all.

create or replace function public.get_my_followers()
returns table (
  follower_profile_id uuid,
  created_at           timestamptz
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select follower_profile_id, created_at
  from follows
  where followed_type = 'user' and followed_id = private.current_profile_id();
$$;

revoke execute on function public.get_my_followers() from public;
grant execute on function public.get_my_followers() to authenticated;

-- To reverse: drop function public.get_my_followers(); restore
-- get_public_profile_by_username to its 0043 shape (drop bio/country from its
-- return columns, matching that migration's own body); restore
-- get_public_profile_stats to its 0014 shape (drop is_public, remove the
-- show_activity_publicly gating on total_xp/badges); drop column
-- profiles.show_activity_publicly.
