-- get_advisors (security) flagged redeem_invite_code as callable by both
-- `anon` and `authenticated` — Postgres grants EXECUTE to PUBLIC by default
-- unless revoked, so the earlier `grant ... to authenticated` alone didn't
-- close the anon path. The function already no-ops safely for anon (it
-- raises "You must be signed in" once private.current_profile_id() comes
-- back null), but tightening the grant is the correct fix rather than
-- relying on that in-body check alone.
revoke execute on function public.redeem_invite_code(text) from public;
revoke execute on function public.redeem_invite_code(text) from anon;
grant execute on function public.redeem_invite_code(text) to authenticated;
