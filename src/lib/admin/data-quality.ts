import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Real data-quality checks against what's actually synced — no heuristic
 * guesses, every number here is a direct count from Supabase. Built for
 * Admin's Data Health page (founder directive 2026-08-15, "DATA QUALITY"
 * section): duplicate/orphaned relationships, missing crests/photos, teams
 * with no squad synced yet. Each check is cheap (single indexed query or
 * two) and safe to run on every Data Health page load — none of this spends
 * football-provider quota, it only reads KIVO's own database.
 */
export interface DataQualityReport {
  teamsMissingCrest: number;
  playersMissingPhoto: number;
  teamsWithNoSquad: number;
  orphanedProviderMappings: number;
}

export async function getDataQualityReport(): Promise<DataQualityReport> {
  const supabase = createServerSupabaseClient();

  const [teamsMissingCrest, playersMissingPhoto, teamsWithNoSquad, orphanedProviderMappings] = await Promise.all([
    supabase.from("teams").select("id", { count: "exact", head: true }).is("crest_url", null),
    supabase.from("players").select("id", { count: "exact", head: true }).is("photo_url", null),
    countTeamsWithNoSquad(supabase),
    countOrphanedProviderMappings(supabase),
  ]);

  return {
    teamsMissingCrest: teamsMissingCrest.count ?? 0,
    playersMissingPhoto: playersMissingPhoto.count ?? 0,
    teamsWithNoSquad,
    orphanedProviderMappings,
  };
}

/**
 * A team with zero rows in `players.current_team_id` has never had a squad
 * sync run for it (or every player since left with nothing re-synced) — real
 * gap, not a heuristic. Runs as two counts rather than a LEFT JOIN + GROUP BY
 * since the Supabase client's query builder can't express that cleanly; both
 * queries are cheap (indexed columns, no row bodies returned).
 */
async function countTeamsWithNoSquad(supabase: ReturnType<typeof createServerSupabaseClient>): Promise<number> {
  const { count: totalTeams } = await supabase.from("teams").select("id", { count: "exact", head: true });
  const { data: teamsWithPlayers } = await supabase
    .from("players")
    .select("current_team_id")
    .not("current_team_id", "is", null);

  const distinctTeamsWithSquad = new Set((teamsWithPlayers ?? []).map((p) => p.current_team_id)).size;
  return Math.max(0, (totalTeams ?? 0) - distinctTeamsWithSquad);
}

/**
 * A provider_mappings row whose kivo_entity_id no longer resolves to a real
 * row (the target was deleted directly, or a sync mis-wrote a stale id) is a
 * genuine invalid-relationship case per the founder's directive. Checked
 * only for the two entity types with a stable single target table (team,
 * player) — competition/season/fixture mappings resolve across more than
 * one possible table depending on entity_type and aren't worth the extra
 * query complexity for a first pass; documented here rather than silently
 * skipped.
 */
async function countOrphanedProviderMappings(supabase: ReturnType<typeof createServerSupabaseClient>): Promise<number> {
  const { data: teamMappings } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id")
    .eq("entity_type", "team");
  const { data: playerMappings } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id")
    .eq("entity_type", "player");

  const teamIds = new Set((teamMappings ?? []).map((m) => m.kivo_entity_id));
  const playerIds = new Set((playerMappings ?? []).map((m) => m.kivo_entity_id));

  const [{ data: realTeams }, { data: realPlayers }] = await Promise.all([
    teamIds.size > 0 ? supabase.from("teams").select("id").in("id", [...teamIds]) : Promise.resolve({ data: [] }),
    playerIds.size > 0
      ? supabase.from("players").select("id").in("id", [...playerIds])
      : Promise.resolve({ data: [] }),
  ]);

  const realTeamIds = new Set((realTeams ?? []).map((t) => t.id));
  const realPlayerIds = new Set((realPlayers ?? []).map((p) => p.id));

  const orphanedTeamMappings = [...teamIds].filter((id) => !realTeamIds.has(id)).length;
  const orphanedPlayerMappings = [...playerIds].filter((id) => !realPlayerIds.has(id)).length;

  return orphanedTeamMappings + orphanedPlayerMappings;
}
