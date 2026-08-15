-- /u/[username] needs to resolve a username to a profile id/identity before
-- it can even call get_public_profiles(uuid[]) — that RPC only accepts an
-- array of already-known ids, and profiles has no anon/cross-user SELECT
-- policy (profiles_select_own, profiles_select_admin), so a plain client
-- lookup by username is impossible for anyone but the owner. Same shape as
-- get_public_profiles, just keyed by username instead of an id array: a
-- SECURITY DEFINER function that returns only the narrow public-identity
-- columns, never role/clerk_user_id/anything else. username is `citext`
-- (case-insensitive unique, enforced at signup — see profiles_username_length
-- in 0001), so this comparison is case-insensitive to match.
create or replace function public.get_public_profile_by_username(p_username text)
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
security definer
-- citext (and its cross-type = operator against text) lives in the
-- `extensions` schema, not `public` (see 0002_lint_hardening.sql's
-- `alter extension citext set schema extensions`), so it must be on the
-- search_path for the comparison below to resolve.
set search_path = public, extensions, pg_temp
stable
as $$
  select id, username, display_name, avatar_url
  from profiles
  where username = p_username::citext;
$$;

revoke execute on function public.get_public_profile_by_username(text) from public;
grant execute on function public.get_public_profile_by_username(text) to anon, authenticated;


-- xp_ledger and user_badges are both owner-only SELECT (xp_ledger_select_own,
-- user_badges_select_own), which blocks a public profile page from showing
-- either. But this codebase already has direct precedent for surfacing an
-- aggregate over an owner-only ledger as public-facing profile data:
-- get_predictions_leaderboard sums the (also owner-only) `predictions` table
-- and publishes the total per user, explicitly reasoning that a summed,
-- already-public-facing aggregate is safe to expose even though the
-- individual rows are not. XP totals and which badges are earned are the
-- same shape of fact (a public accomplishment summary, not a private detail
-- like an individual xp_ledger.reason string or predictions pick before
-- lock) — `badges` itself is already public-select besides. This function
-- follows that precedent: it returns only a summed XP total and the earned
-- badge list (code/name/description/icon_url/awarded_at, sourced from the
-- already-public `badges` table), never a raw xp_ledger row.
create or replace function public.get_public_profile_stats(p_profile_id uuid)
returns table (
  total_xp bigint,
  badges   jsonb
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    coalesce((select sum(amount) from xp_ledger where profile_id = p_profile_id), 0)::bigint as total_xp,
    coalesce(
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
    ) as badges;
$$;

revoke execute on function public.get_public_profile_stats(uuid) from public;
grant execute on function public.get_public_profile_stats(uuid) to anon, authenticated;

-- To reverse: drop function public.get_public_profile_by_username(text);
-- drop function public.get_public_profile_stats(uuid) — /u/[username] and any
-- public profile stats display depend on both.
