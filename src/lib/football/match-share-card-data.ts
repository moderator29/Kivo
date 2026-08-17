import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { buildMatchShareCardData, type MatchShareCardData, type MatchShareCardEventInput } from "@/lib/football/match-share-card";

/**
 * Fetches one fixture's real card data straight from Supabase — the same
 * columns Match Centre's own page already selects
 * (src/app/(app)/matches/[id]/page.tsx) — and reduces it through
 * buildMatchShareCardData. Shared by the on-page MatchShareCard preview
 * (via a server-rendered props fetch in the matches/[id] page) and the
 * /share-card image route, so both read the exact same real data for the
 * exact same fixture id — never two independently-drifting queries.
 */
export async function getMatchShareCardData(
  supabase: SupabaseClient<Database>,
  fixtureId: string,
): Promise<MatchShareCardData | null> {
  const { data: fixture } = await supabase
    .from("fixtures")
    .select(
      `status, kickoff_at, home_score, away_score, minute_elapsed,
       competition:competitions(name, short_name),
       venue:venues(name, city),
       home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)`,
    )
    .eq("id", fixtureId)
    .maybeSingle();

  if (!fixture) return null;

  const { data: events } = await supabase
    .from("fixture_events")
    .select(
      `event_type, minute, added_time, team_id,
       player:players!fixture_events_player_id_fkey(full_name, known_as)`,
    )
    .eq("fixture_id", fixtureId)
    .in("event_type", ["goal", "penalty_goal", "own_goal"])
    .order("minute", { ascending: true });

  const eventInputs: MatchShareCardEventInput[] = (events ?? []).map((e) => ({
    event_type: e.event_type,
    minute: e.minute,
    added_time: e.added_time,
    team_id: e.team_id,
    player_name: e.player?.known_as ?? e.player?.full_name ?? null,
  }));

  return buildMatchShareCardData(fixture, eventInputs);
}
