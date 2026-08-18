-- Follow-up to 0048_profile_privacy_bio_country_and_followers.sql.
--
-- This project's default privileges auto-grant EXECUTE on newly created
-- public-schema functions to anon (a separate explicit grant, not routed
-- through the PUBLIC pseudo-role) — the exact same quirk
-- 0025_lock_down_xp_total_and_prune_sync_runs_grants.sql already documented
-- and fixed for get_xp_total/prune_sync_runs. `revoke ... from public` in
-- 0048 did not actually strip anon's access to get_my_followers() — confirmed
-- via information_schema.routine_privileges and get_advisors(security) after
-- applying 0048, same verification 0025's own comment describes.
--
-- Not a real data leak (get_my_followers() resolves
-- private.current_profile_id() internally, which is null for anon, so an
-- anon caller only ever got an empty result — never another user's rows) but
-- it contradicts this function's own stated intent (`grant ... to
-- authenticated` only, deliberately excluding anon) and this codebase's own
-- established fix for the identical issue. Revoke explicitly.

revoke execute on function public.get_my_followers() from anon;

-- To reverse: grant execute on function public.get_my_followers() to anon —
-- not recommended, get_my_followers() is meant for a signed-in caller's own
-- followers only.
