import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/profile";

export interface GroundingContext {
  /** Rendered as plain text and injected into the system prompt — kept small and structured on purpose. */
  summary: string;
  hasFollowedEntities: boolean;
  hasSyncedFixtures: boolean;
}

/**
 * Deterministic retrieval BEFORE the model ever runs, per the grounding
 * architecture: we tell the model exactly what KIVO actually knows right
 * now, and the system prompt (see chat route) forbids it from answering
 * specific/current football questions with anything outside this context.
 */
export async function buildGroundingContext(profile: Profile | null): Promise<GroundingContext> {
  if (!profile) {
    return { summary: "No signed-in user context available.", hasFollowedEntities: false, hasSyncedFixtures: false };
  }

  const supabase = createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: follows }, { data: favouriteTeam }, { data: todaysFixtures }] = await Promise.all([
    supabase.from("follows").select("followed_type, followed_id").eq("follower_profile_id", profile.id).limit(20),
    profile.favourite_team_id
      ? supabase.from("teams").select("name").eq("id", profile.favourite_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("fixtures")
      .select("kickoff_at, status, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(name), away_team:teams!fixtures_away_team_id_fkey(name), competition:competitions(name)")
      .gte("kickoff_at", `${today}T00:00:00Z`)
      .lte("kickoff_at", `${today}T23:59:59Z`)
      .order("kickoff_at", { ascending: true })
      .limit(30),
  ]);

  const lines: string[] = [];
  lines.push(`User: @${profile.username}${favouriteTeam ? `, favourite team: ${favouriteTeam.name}` : ""}.`);

  if (follows && follows.length > 0) {
    lines.push(`Follows ${follows.length} team(s)/player(s)/competition(s) (internal IDs only, no names resolved here).`);
  } else {
    lines.push("Has not followed any teams, players or competitions yet.");
  }

  if (todaysFixtures && todaysFixtures.length > 0) {
    lines.push(`Today's synced fixtures (${todaysFixtures.length}):`);
    for (const f of todaysFixtures.slice(0, 15)) {
      const home = f.home_team?.name ?? "Unknown";
      const away = f.away_team?.name ?? "Unknown";
      const comp = f.competition?.name ?? "Unknown competition";
      const score = f.home_score != null && f.away_score != null ? ` (${f.home_score}-${f.away_score})` : "";
      lines.push(`- ${home} vs ${away}${score} — ${comp}, status: ${f.status}`);
    }
  } else {
    lines.push(
      "No fixtures are synced into KIVO's database yet — the football data provider integration exists but no sync has populated real matches. Do not invent fixtures, scores, or standings.",
    );
  }

  return {
    summary: lines.join("\n"),
    hasFollowedEntities: !!follows && follows.length > 0,
    hasSyncedFixtures: !!todaysFixtures && todaysFixtures.length > 0,
  };
}
