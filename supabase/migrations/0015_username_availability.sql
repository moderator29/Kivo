-- Onboarding's saveUsernameStep and Settings' updateUsername both only find
-- out about a username collision from a 23505 after a full round trip.
-- profiles has no anon/cross-user SELECT policy (profiles_select_own_or_admin
-- restricts even authenticated callers to their own row), so a live-as-you-
-- type availability check can't be a plain client query — same problem
-- get_public_profile_by_username (0014) solved for username lookup. This
-- follows that exact shape: a SECURITY DEFINER function, but narrowed even
-- further than 0014's — it returns only a boolean, never any profile column,
-- since "is this name taken" is the only thing the caller needs. username is
-- `citext` (case-insensitive unique, enforced at signup — see
-- profiles_username_length in 0001), so the comparison below is
-- case-insensitive to match, exactly like 0014.
--
-- p_exclude_profile_id lets a signed-in user re-check their own current
-- username (e.g. Settings' UsernameEditor) without it reporting itself as
-- taken.
create or replace function public.is_username_available(p_username text, p_exclude_profile_id uuid default null)
returns boolean
language sql
security definer
-- citext lives in the `extensions` schema (see 0002_lint_hardening.sql's
-- `alter extension citext set schema extensions`), so it must be on the
-- search_path for the `::citext` cast/comparison below to resolve.
set search_path = public, extensions, pg_temp
stable
as $$
  select not exists (
    select 1
    from profiles
    where username = p_username::citext
      and (p_exclude_profile_id is null or id <> p_exclude_profile_id)
  );
$$;

revoke execute on function public.is_username_available(text, uuid) from public;
grant execute on function public.is_username_available(text, uuid) to anon, authenticated;
