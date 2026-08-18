-- =============================================================================
-- Fantasy ownership percentage (RECOMMENDATIONS.md item 296)
-- =============================================================================
-- Player detail pages want a real "Rostered by N% of KIVO fantasy squads
-- this gameweek" figure — fantasy_rosters is owner-only RLS
-- (fantasy_rosters_all_own, 0001), so a plain cross-user query can't compute
-- this. Same narrow-aggregate-over-an-owner-only-table shape
-- get_prediction_consensus and get_fan_rating_summary (both 0032) already
-- establish for different tables: expose only a real count, never another
-- manager's individual squad.
--
-- Resolves "the current gameweek" for the given season inside the function
-- itself (a scalar subquery against fantasy_gameweeks.is_current) rather
-- than trusting a caller-supplied gameweek id, so this can never be pointed
-- at a gameweek that isn't actually this season's current one. The scalar
-- subquery (not a join) keeps this a plain aggregate with no GROUP BY, so it
-- always returns exactly one row — (0, 0) when the season has no current
-- gameweek yet, same "always one row, real zero rather than an absent one"
-- shape get_fan_rating_summary already established, rather than an empty
-- result set a caller would have to special-case.
--
-- Returns player_count/total_count (not a pre-divided percentage) so the
-- caller applies its own minimum-sample suppression before presenting a
-- rate — the same "return real counts, let the UI decide when a rate is
-- meaningful" discipline get_prediction_consensus's own comment establishes.
--
-- total_count counts real starting-XI slots (fantasy_rosters rows with
-- is_starting = true) across every team's current-gameweek squad, not
-- distinct teams — the same denominator RECOMMENDATIONS.md items 250/296
-- both describe for this exact "real ownership" computation.
create or replace function public.get_fantasy_ownership(p_player_id uuid, p_season_id uuid)
returns table (
  player_count bigint,
  total_count  bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    count(*) filter (where fr.player_id = p_player_id)::bigint as player_count,
    count(*)::bigint as total_count
  from fantasy_rosters fr
  where fr.is_starting
    and fr.gameweek_id = (
      select fg.id from fantasy_gameweeks fg where fg.season_id = p_season_id and fg.is_current limit 1
    );
$$;

revoke execute on function public.get_fantasy_ownership(uuid, uuid) from public;
grant execute on function public.get_fantasy_ownership(uuid, uuid) to anon, authenticated;

-- To reverse: drop function public.get_fantasy_ownership(uuid, uuid).
