-- =============================================================================
-- Close the private-fantasy-league gate-crash
-- =============================================================================
-- APPLIED to the live project (gkyjfihxxdynfwqhhpyn) on 2026-08-19, immediately
-- after 0095, by the security-sweep agent. Finding F3 in docs/SECURITY_REVIEW.md.
--
-- THE HOLE. `fantasy_teams_all_own` was `for all to authenticated` with
-- `using`/`with check` of `owner_profile_id = private.current_profile_id()` and
-- nothing else. Joining a league is supposed to go through one of two
-- SECURITY DEFINER functions — `redeem_invite_code` (private leagues: checks the
-- code, rate-limits itself, checks capacity) or `join_public_fantasy_league`
-- (refuses `is_private`, refuses a full league). Both are correctly written.
-- Both were irrelevant, because
--
--     POST /rest/v1/fantasy_teams
--     { "owner_profile_id": "<my own id>", "league_id": "<any league at all>" }
--
-- satisfies the policy — the row genuinely is the caller's own. That walks
-- straight past the invite code on a private league and past `max_teams` on any
-- league. Socially it is nastier than the roster hole 0095 closed: that one lets
-- somebody cheat their own score, this one lets a stranger into a private league
-- between friends.
--
-- WHY THIS IS NOT A `WITH CHECK` THAT APPROXIMATES THE RULES. The coordinator's
-- question was whether capacity and the invite code are set-level properties
-- that a per-row check can only approximate, the way squad size and budget are
-- for `fantasy_rosters`. They are not — but writing them into a policy would
-- still have been wrong, for a reason that only shows up when you try it.
--
-- A subquery inside a policy is evaluated AS THE CALLER, so RLS applies to it
-- too. `fantasy_leagues_all_own` restricts a plain read to the league's creator,
-- and `fantasy_teams_select_own` restricts a plain read to the caller's own
-- teams. A capacity check written as
--
--     (select count(*) from fantasy_teams ft where ft.league_id = fl.id) < fl.max_teams
--
-- would therefore count only the CALLER'S OWN teams in that league — at most one,
-- thanks to `fantasy_teams_unique_owner_per_league` — and would pass
-- unconditionally forever. It would look like enforcement and enforce nothing.
-- That is precisely the "worst of the three options" failure: a partial
-- predicate that stops people checking.
--
-- THE ACTUAL RULE, stated positively: a direct insert is only ever for a league
-- you created yourself. Every other way into a league is a door, and both doors
-- already exist, already do the checks, and already bypass RLS because they are
-- SECURITY DEFINER. This is the same shape `prediction_league_members` has had
-- all along — no INSERT policy at all, `redeem_prediction_invite_code` as the
-- only writer — which is the pattern this codebase already validated once.
drop policy if exists fantasy_teams_all_own on fantasy_teams;

create policy fantasy_teams_select_own on fantasy_teams
  for select to authenticated
  using (owner_profile_id = private.current_profile_id());

-- Creating a league creates the creator's own team, through
-- getOrCreateFantasyTeam on the ordinary session client. That is the one direct
-- insert the product genuinely performs, and it is self-evidently legitimate:
-- you cannot gate-crash a league you just created.
create policy fantasy_teams_insert_own_league on fantasy_teams
  for insert to authenticated
  with check (
    owner_profile_id = private.current_profile_id()
    and exists (
      select 1 from fantasy_leagues fl
      where fl.id = fantasy_teams.league_id
        and fl.creator_profile_id = private.current_profile_id()
    )
  );

-- Renaming your team stays ownership-only: a member who joined a stranger's
-- league through an invite code is legitimately not its creator, and must still
-- be able to edit the row.
create policy fantasy_teams_update_own on fantasy_teams
  for update to authenticated
  using (owner_profile_id = private.current_profile_id())
  with check (owner_profile_id = private.current_profile_id());

create policy fantasy_teams_delete_own on fantasy_teams
  for delete to authenticated
  using (owner_profile_id = private.current_profile_id());

-- -----------------------------------------------------------------------------
-- league_id is immutable, or the UPDATE policy is a second front door
-- -----------------------------------------------------------------------------
-- The UPDATE policy above has to stay ownership-only so members can rename their
-- team, which means `PATCH /rest/v1/fantasy_teams?id=eq.<mine>` with a new
-- `league_id` would re-open exactly the hole the INSERT policy just closed. RLS
-- cannot express "this column may not change" — a policy's WITH CHECK sees the
-- new row and has no access to the old one — so this is a trigger.
--
-- It RAISES rather than silently dropping the change. A BEFORE trigger that
-- quietly refuses a write is invisible to review and produces a bug nobody can
-- explain; one that errors tells the caller exactly what happened. (This branch
-- has already lost an evening to the silent variety — see 0093.)
--
-- Moving a team between leagues is not a feature KIVO has in any case: its
-- rosters and points are keyed to gameweeks in the league's own season, so a
-- move would orphan every one of them.
create or replace function private.forbid_fantasy_team_league_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.league_id is distinct from old.league_id then
    raise exception 'A fantasy team cannot be moved between leagues'
      using errcode = '42501',
            hint = 'Leave the league and join the other one through its invite code.';
  end if;
  return new;
end;
$$;

revoke execute on function private.forbid_fantasy_team_league_change() from public;

drop trigger if exists trg_fantasy_teams_league_id_immutable on fantasy_teams;
create trigger trg_fantasy_teams_league_id_immutable
  before update of league_id on fantasy_teams
  for each row execute function private.forbid_fantasy_team_league_change();

-- To reverse:
--   drop trigger if exists trg_fantasy_teams_league_id_immutable on fantasy_teams;
--   drop function if exists private.forbid_fantasy_team_league_change();
--   drop policy fantasy_teams_delete_own on fantasy_teams;
--   drop policy fantasy_teams_update_own on fantasy_teams;
--   drop policy fantasy_teams_insert_own_league on fantasy_teams;
--   drop policy fantasy_teams_select_own on fantasy_teams;
--   create policy fantasy_teams_all_own on fantasy_teams for all to authenticated
--     using (owner_profile_id = private.current_profile_id())
--     with check (owner_profile_id = private.current_profile_id());
