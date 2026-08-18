-- =============================================================================
-- 0062 — Close the PUBLIC grant that `revoke ... from anon` cannot reach
-- =============================================================================
-- Follow-on to 0059 (KN-120/KN-27), found by verifying that migration rather
-- than by assuming it worked.
--
-- 0059 revoked EXECUTE from `anon` on every public RPC. Re-querying
-- `has_function_privilege('anon', ...)` afterwards still showed one survivor:
--
--   public.set_updated_at  proacl = {=X/postgres, postgres=X/postgres, ...}
--
-- The leading `=X/` is a grant to **PUBLIC**, and `anon` is a member of PUBLIC.
-- Revoking a privilege from a role does not remove that role's access when the
-- access comes from PUBLIC — the two are separate grants and both have to go.
-- This is the exact mistake that makes a lockdown migration look successful and
-- change nothing, so it is worth stating plainly rather than quietly fixing.
--
-- Every helper in the `private` schema has the same PUBLIC grant. Those are not
-- currently reachable by `anon` — 0059 revoked its USAGE on the schema, and
-- without schema USAGE a function-level grant is inert — but relying on one
-- layer when two are available is not a decision anyone would make on purpose.
-- This removes the second layer as well.
--
-- The established pattern in this repo (0008, 0011, 0012, 0014, 0015, 0018:
-- `revoke execute on function ... from public` immediately after creating it)
-- was simply never applied to the `private` helpers or to `set_updated_at`.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Make the implicit grant explicit BEFORE removing the implicit one
-- -----------------------------------------------------------------------------
-- private.can_moderate() is reached by `authenticated` ONLY through PUBLIC — it
-- has no explicit grant of its own (verified against pg_proc.proacl:
-- `{=X/postgres, postgres=X/postgres}`, no `authenticated=X`). Revoking PUBLIC
-- without this line first would break every policy that calls it: the reports
-- queue, the moderation surfaces, and the admin visibility branch of
-- posts_select_public/comments_select_public. Order matters here.

grant execute on function private.can_moderate() to authenticated;


-- -----------------------------------------------------------------------------
-- 2. Drop the PUBLIC grant on the identity/moderation helpers
-- -----------------------------------------------------------------------------
-- `authenticated` keeps an explicit grant on each of these (0001 + 0045 + 0053,
-- and section 1 above for can_moderate), so nothing a signed-in user does
-- changes. What changes is that no future role — including one Supabase adds —
-- inherits access to KIVO's identity resolution simply by existing.

revoke execute on function private.current_profile_id() from public;
revoke execute on function private.current_role() from public;
revoke execute on function private.is_admin() from public;
revoke execute on function private.has_role(text[]) from public;
revoke execute on function private.can_moderate() from public;
revoke execute on function private.effective_moderation_status(moderation_status, timestamptz) from public;
revoke execute on function private.effective_moderation_status_for(uuid) from public;
revoke execute on function private.current_moderation_status() from public;
revoke execute on function private.current_moderation_raw_snapshot() from public;
revoke execute on function private.is_moderation_write_blocked() from public;


-- -----------------------------------------------------------------------------
-- 3. The two trigger functions
-- -----------------------------------------------------------------------------
-- Postgres checks EXECUTE on a trigger function when the trigger is CREATED,
-- not each time it fires, so removing the grant cannot break the triggers that
-- already use these. Same reasoning 0008/0018 applied to their own functions.

revoke execute on function private.set_poll_vote_post_id() from public;
revoke execute on function public.set_updated_at() from public;


-- -----------------------------------------------------------------------------
-- 4. Assert it actually took effect this time
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ) then
    raise exception 'anon can still execute at least one public/private function';
  end if;

  -- The other direction: a lockdown that also locks out the app is a worse bug
  -- than the one it fixes.
  if not (
    has_function_privilege('authenticated', 'private.current_profile_id()', 'EXECUTE')
    and has_function_privilege('authenticated', 'private.is_admin()', 'EXECUTE')
    and has_function_privilege('authenticated', 'private.can_moderate()', 'EXECUTE')
  ) then
    raise exception 'authenticated lost access to a private helper every RLS policy depends on';
  end if;
end $$;


-- =============================================================================
-- Known remaining gap, stated rather than left to be rediscovered
-- =============================================================================
-- This project carries TWO sets of default privileges on schema `public`: one
-- granted by `postgres` and one by `supabase_admin`. 0059 fixed the `postgres`
-- one, which covers every function this repository creates (migrations run as
-- postgres). The `supabase_admin` one still reads
-- `{... anon=X/supabase_admin ...}` and cannot be altered from here — only its
-- owning role can change it. In practice that means a function created by
-- Supabase's own tooling under `supabase_admin` would still arrive
-- anon-executable. Nothing in `supabase/migrations/` does that, so the
-- repository's own surface is closed; this note exists so the next person who
-- audits `pg_default_acl` and sees an `anon=X` row knows it is a known,
-- out-of-reach one rather than a regression of 0059.
