-- Guests (and any signed-in user viewing someone else's content) currently
-- see every post/leaderboard author as a name-less fallback: profiles has no
-- anon SELECT policy, and profiles_select_own_or_admin restricts even
-- authenticated callers to their own row (or an admin). A SECURITY DEFINER
-- view was tried first but Postgres/Supabase's linter correctly flags any
-- security-definer view as an unverifiable risk (ERROR level) since it can't
-- confirm the view stays narrow — so this uses the same shape already
-- established in this codebase for crossing an RLS boundary safely (see
-- get_fantasy_team_league, get_fantasy_league_leaderboard, redeem_invite_code):
-- a SECURITY DEFINER function that only ever returns exactly the public-
-- identity columns, never role/clerk_user_id/anything else, no matter what a
-- caller asks for.
create or replace function public.get_public_profiles(p_ids uuid[])
returns table (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select id, username, display_name, avatar_url
  from profiles
  where id = any(p_ids);
$$;

revoke execute on function public.get_public_profiles(uuid[]) from public;
grant execute on function public.get_public_profiles(uuid[]) to anon, authenticated;
