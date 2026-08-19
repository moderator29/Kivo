-- =============================================================================
-- 0102 — Stop the prediction-league member policy calling itself
-- =============================================================================
-- APPLIED to the live project as migration name
-- `prediction_league_members_policy_recursion`. Verified afterwards by reading
-- pg_policies (the qual no longer references the table) and pg_proc (the
-- function is SECURITY DEFINER with acl `postgres=X | authenticated=X` — no
-- public, no anon).
--
-- prediction_league_members_select_member (0075) was written as:
--
--   using (profile_id = private.current_profile_id()
--          or exists (select 1 from prediction_league_members mine
--                     where mine.league_id = prediction_league_members.league_id
--                       and mine.profile_id = private.current_profile_id()))
--
-- The EXISTS reads prediction_league_members, so evaluating the policy requires
-- evaluating the policy. Postgres raises 42P17, "infinite recursion detected in
-- policy for relation".
--
-- Why nobody saw it: the first clause short-circuits for the caller's OWN row,
-- and every path exercised so far either returned at an ownership check or ran
-- against an empty table. The live database has one real account and no
-- populated leagues. The moment a second person joins a league, /predictions
-- fails for both of them — so this was a bug waiting for the product's first
-- successful growth loop.
--
-- Found by running the product against a seeded local database rather than by
-- reading it, which is the whole argument for having built that harness.
--
-- The fix is the indirection this codebase already uses for identity: move the
-- lookup into a SECURITY DEFINER function, which runs with the definer's rights
-- and therefore does not re-enter the policy. Same visibility rule, expressed
-- once, in a place that cannot recurse.
--
-- Grants are stated explicitly rather than inherited. A SECURITY DEFINER
-- function that PUBLIC can execute hands out the definer's rights by accident,
-- and this branch has already had one near-miss of exactly that shape.
create or replace function private.is_prediction_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from prediction_league_members m
    where m.league_id = p_league_id
      and m.profile_id = private.current_profile_id()
  );
$$;

revoke execute on function private.is_prediction_league_member(uuid) from public, anon;
grant execute on function private.is_prediction_league_member(uuid) to authenticated;

drop policy if exists prediction_league_members_select_member on prediction_league_members;

create policy prediction_league_members_select_member on prediction_league_members
  for select to authenticated
  using (
    profile_id = private.current_profile_id()
    or private.is_prediction_league_member(league_id)
  );
