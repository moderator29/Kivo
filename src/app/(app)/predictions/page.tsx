import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { PredictionCard } from "@/components/predictions/prediction-card";
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

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Predictions</h1>
        <p className="text-sm text-foreground-muted">Pick an outcome before kickoff — predictions lock the moment a match starts.</p>
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
          />
        ))}
      </div>
    </div>
  );
}
