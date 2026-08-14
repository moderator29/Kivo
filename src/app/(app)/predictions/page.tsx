import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { PredictionCard } from "@/components/predictions/prediction-card";
import { PredictionsLeaderboard, type LeaderboardEntry } from "@/components/predictions/predictions-leaderboard";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "predictions")!;

export default async function PredictionsPage() {
  const profile = await getOrCreateProfile();
  const supabase = createServerSupabaseClient();

  const { data: fixtures } = await supabase
    .from("fixtures")
    .select(
      `id, kickoff_at, status,
       home_team:teams!fixtures_home_team_id_fkey(id, name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(id, name, crest_url),
       competition:competitions(name, short_name)`,
    )
    .eq("status", "scheduled")
    .gt("kickoff_at", new Date().toISOString())
    .order("kickoff_at", { ascending: true })
    .limit(20);

  if (!fixtures || fixtures.length === 0) {
    return (
      <ComingSoon icon={item.icon} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  const fixtureIds = fixtures.map((f) => f.id);
  const existingPredictions = profile
    ? (
        await supabase
          .from("predictions")
          .select("fixture_id, predicted_outcome")
          .eq("profile_id", profile.id)
          .in("fixture_id", fixtureIds)
      ).data
    : null;

  const predictionByFixture = new Map((existingPredictions ?? []).map((p) => [p.fixture_id, p.predicted_outcome]));

  // Aggregate real scored predictions into a leaderboard. `points_awarded` is
  // nullable and nothing in this codebase writes it yet (resolution/scoring
  // is a separate, out-of-scope backend feature) — until it does, this
  // resolves to an empty list and the component shows an honest empty state
  // rather than a fabricated or all-zero table.
  //
  // Note: `predictions` RLS (`predictions_select_own`) only ever lets a
  // caller see their own rows, so even once scoring lands this query can't
  // surface a true cross-user leaderboard through this client — that needs
  // a follow-up migration (e.g. a SECURITY DEFINER RPC exposing just
  // profile_id + summed points) which is out of scope here.
  const { data: scoredPredictions } = await supabase
    .from("predictions")
    .select("profile_id, points_awarded, profile:profiles!predictions_profile_id_fkey(username, display_name)")
    .not("points_awarded", "is", null);

  const pointsByProfile = new Map<string, { name: string; points: number }>();
  for (const row of scoredPredictions ?? []) {
    if (row.points_awarded === null) continue;
    const existing = pointsByProfile.get(row.profile_id);
    if (existing) {
      existing.points += row.points_awarded;
    } else {
      pointsByProfile.set(row.profile_id, {
        name: row.profile?.display_name || row.profile?.username || "Unknown",
        points: row.points_awarded,
      });
    }
  }

  const leaderboardEntries: LeaderboardEntry[] = Array.from(pointsByProfile.entries())
    .map(([profileId, { name, points }]) => ({ profileId, name, points }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Predictions</h1>
        <p className="text-sm text-foreground-muted">Pick an outcome before kickoff. Predictions lock the moment a match starts.</p>
      </FadeIn>

      <div className="flex flex-col gap-3">
        {fixtures.map((fixture) => (
          <PredictionCard
            key={fixture.id}
            fixtureId={fixture.id}
            kickoffAt={fixture.kickoff_at}
            competitionName={fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition"}
            homeTeam={{
              id: fixture.home_team?.id ?? null,
              name: fixture.home_team?.name ?? "Home team",
              crest_url: fixture.home_team?.crest_url ?? null,
            }}
            awayTeam={{
              id: fixture.away_team?.id ?? null,
              name: fixture.away_team?.name ?? "Away team",
              crest_url: fixture.away_team?.crest_url ?? null,
            }}
            initialPrediction={predictionByFixture.get(fixture.id) ?? null}
            signedIn={Boolean(profile)}
          />
        ))}
      </div>

      <FadeIn delay={0.1}>
        <PredictionsLeaderboard entries={leaderboardEntries} viewerProfileId={profile?.id ?? null} />
      </FadeIn>
    </div>
  );
}
