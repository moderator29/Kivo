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
    supabase
      .from("follows")
      .select("followed_type, followed_id")
      .eq("follower_profile_id", profile.id)
      .in("followed_type", ["team", "player", "competition"])
      .limit(20),
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

  // Resolve the polymorphic follows rows to real names. follows.followed_id
  // has no DB-level FK (see 0001_kivo_core_schema.sql's comment on the
  // `follows` table), so this is the same two-step "collect ids per type,
  // then batch-fetch each entity table" pattern already used by
  // src/app/(app)/profile/following/page.tsx for the same reason.
  const teamIds = (follows ?? []).filter((f) => f.followed_type === "team").map((f) => f.followed_id);
  const playerIds = (follows ?? []).filter((f) => f.followed_type === "player").map((f) => f.followed_id);
  const competitionIds = (follows ?? []).filter((f) => f.followed_type === "competition").map((f) => f.followed_id);

  const [{ data: followedTeams }, { data: followedPlayers }, { data: followedCompetitions }] = await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("name").in("id", teamIds)
      : Promise.resolve({ data: [] as { name: string }[] }),
    playerIds.length
      ? supabase.from("players").select("full_name, known_as").in("id", playerIds)
      : Promise.resolve({ data: [] as { full_name: string; known_as: string | null }[] }),
    competitionIds.length
      ? supabase.from("competitions").select("name").in("id", competitionIds)
      : Promise.resolve({ data: [] as { name: string }[] }),
  ]);

  const lines: string[] = [];
  lines.push(`User: @${profile.username}${favouriteTeam ? `, favourite team: ${favouriteTeam.name}` : ""}.`);

  // A followed row whose target was since deleted resolves to nothing here
  // (same caveat as the following page) and is simply dropped rather than
  // listed as a broken reference.
  const followedNames = [
    ...(followedTeams ?? []).map((t) => `${t.name} (team)`),
    ...(followedPlayers ?? []).map((p) => `${p.known_as ?? p.full_name} (player)`),
    ...(followedCompetitions ?? []).map((c) => `${c.name} (competition)`),
  ];

  if (followedNames.length > 0) {
    lines.push(`Follows: ${followedNames.join(", ")}.`);
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
      "No fixtures are synced into KIVO's database yet. The football data provider integration exists but no sync has populated real matches. Do not invent fixtures, scores, or standings.",
    );
  }

  return {
    summary: lines.join("\n"),
    hasFollowedEntities: followedNames.length > 0,
    hasSyncedFixtures: !!todaysFixtures && todaysFixtures.length > 0,
  };
}
