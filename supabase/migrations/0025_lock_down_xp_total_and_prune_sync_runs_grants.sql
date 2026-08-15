-- Follow-up to 0023_xp_total_and_sync_run_pruning.sql.
--
-- This project's default privileges auto-grant EXECUTE on newly created
-- public-schema functions to anon (a separate explicit grant, not routed
-- through the PUBLIC pseudo-role), so `revoke ... from public` in 0023 did
-- not actually strip anon's access -- confirmed via
-- information_schema.routine_privileges and get_advisors(security) after
-- applying 0023. For prune_sync_runs this was a real hole: an anonymous
-- caller could hit /rest/v1/rpc/prune_sync_runs directly and delete
-- sync_runs rows with no admin check at all (the admin gate lives in the
-- calling server action, not inside the SQL function). Revoke explicitly
-- from anon on both functions; get_xp_total also drops anon since its
-- ownership check already made anon access harmless (always returns 0) but
-- there's no reason to leave it grantable.
revoke execute on function public.get_xp_total(uuid) from anon;
revoke execute on function public.prune_sync_runs(integer) from anon;
