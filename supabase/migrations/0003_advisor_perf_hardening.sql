-- Cover foreign keys the Supabase performance advisor flagged as unindexed.
-- Each supports FK-direction lookups (e.g. "all comments by this profile",
-- cascade-delete planning) that no existing index already covers.
create index if not exists idx_comments_author_profile_id on comments (author_profile_id);
create index if not exists idx_fantasy_leagues_creator_profile_id on fantasy_leagues (creator_profile_id);
create index if not exists idx_fantasy_points_gameweek_id on fantasy_points (gameweek_id);
create index if not exists idx_fantasy_rosters_gameweek_id on fantasy_rosters (gameweek_id);
create index if not exists idx_fantasy_rosters_player_id on fantasy_rosters (player_id);
create index if not exists idx_fantasy_teams_owner_profile_id on fantasy_teams (owner_profile_id);
create index if not exists idx_fixture_events_player_id on fixture_events (player_id);
create index if not exists idx_fixture_events_related_player_id on fixture_events (related_player_id);
create index if not exists idx_fixture_events_team_id on fixture_events (team_id);
create index if not exists idx_fixtures_season_id on fixtures (season_id);
create index if not exists idx_fixtures_venue_id on fixtures (venue_id);
create index if not exists idx_lineups_player_id on lineups (player_id);
create index if not exists idx_lineups_team_id on lineups (team_id);
create index if not exists idx_moderation_actions_report_id on moderation_actions (report_id);
create index if not exists idx_reactions_profile_id on reactions (profile_id);
create index if not exists idx_reports_reporter_profile_id on reports (reporter_profile_id);
create index if not exists idx_reports_resolved_by_profile_id on reports (resolved_by_profile_id);
create index if not exists idx_standings_team_id on standings (team_id);
create index if not exists idx_user_badges_badge_id on user_badges (badge_id);

-- Multiple permissive RLS policies for the same role+action make Postgres
-- evaluate every one of them per row; the advisor flags four such pairs.
-- Merging is a pure performance fix — each replacement policy accepts
-- exactly the rows the two policies it replaces accepted, nothing more.

-- profiles: "own row" and "admin sees all" were separate permissive SELECT
-- policies; combine with OR into one. Same for UPDATE, where the owner
-- branch keeps its "role can't change via self-service" WITH CHECK and the
-- admin branch keeps full access — the OR only changes evaluation cost, not
-- who can see or touch what.
drop policy profiles_select_own on profiles;
drop policy profiles_select_admin on profiles;
create policy profiles_select_own_or_admin on profiles
  for select to authenticated
  using (clerk_user_id = private.current_clerk_user_id() or private.is_admin());

drop policy profiles_update_own on profiles;
drop policy profiles_update_admin on profiles;
create policy profiles_update_own_or_admin on profiles
  for update to authenticated
  using (clerk_user_id = private.current_clerk_user_id() or private.is_admin())
  with check (
    (clerk_user_id = private.current_clerk_user_id() and role = private.current_role())
    or private.is_admin()
  );

-- badges / fantasy_gameweeks: the admin policy used `for all`, which also
-- covers SELECT and doubled up with the public "using (true)" read policy —
-- true is already a superset of any admin check, so admins lose no access by
-- narrowing their policy to insert/update/delete. `for all` can't be split
-- into a single "insert, update" policy (Postgres requires one command per
-- policy), hence three policies below in place of one.
drop policy badges_write_admin on badges;
create policy badges_insert_admin on badges
  for insert to authenticated
  with check (private.has_role(array['admin', 'super_admin', 'content_admin']));
create policy badges_update_admin on badges
  for update to authenticated
  using (private.has_role(array['admin', 'super_admin', 'content_admin']))
  with check (private.has_role(array['admin', 'super_admin', 'content_admin']));
create policy badges_delete_admin on badges
  for delete to authenticated
  using (private.has_role(array['admin', 'super_admin', 'content_admin']));

drop policy fantasy_gameweeks_write_admin on fantasy_gameweeks;
create policy fantasy_gameweeks_insert_admin on fantasy_gameweeks
  for insert to authenticated
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy fantasy_gameweeks_update_admin on fantasy_gameweeks
  for update to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']))
  with check (private.has_role(array['football_data_admin', 'admin', 'super_admin']));
create policy fantasy_gameweeks_delete_admin on fantasy_gameweeks
  for delete to authenticated
  using (private.has_role(array['football_data_admin', 'admin', 'super_admin']));

-- To reverse: drop the twenty indexes above (safe any time, they're pure
-- performance aids), then drop each replacement policy and recreate its two
-- predecessors (profiles_select_own/profiles_select_admin,
-- profiles_update_own/profiles_update_admin, badges_write_admin `for all`,
-- fantasy_gameweeks_write_admin `for all`) from migration 0001's originals.
