import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { PredictionCard, type PredictionConsensus } from "@/components/predictions/prediction-card";
import { PredictionsLeaderboard, type LeaderboardEntry } from "@/components/predictions/predictions-leaderboard";
import { getNavItem } from "@/lib/navigation";
import { staggerDelay } from "@/lib/stagger";

const item = getNavItem("predictions");

export const metadata: Metadata = { title: item.label };

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
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.comingSoonDescription ?? "Nothing synced yet."} />
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

  // RECOMMENDATIONS item 168: same predictions_select_own restriction as the
  // leaderboard below — a plain client query can never see picks other than
  // the caller's own, so the real per-outcome counts each PredictionCard
  // shows come from get_prediction_consensus (SECURITY DEFINER), batched for
  // every fixture on this page in one round trip.
  const { data: consensusRows } = await supabase.rpc("get_prediction_consensus", { p_fixture_ids: fixtureIds });
  const consensusByFixture = new Map<string, PredictionConsensus>();
  for (const row of consensusRows ?? []) {
    const entry = consensusByFixture.get(row.fixture_id) ?? { home_win: 0, draw: 0, away_win: 0 };
    entry[row.predicted_outcome] = row.pick_count;
    consensusByFixture.set(row.fixture_id, entry);
  }

  // `predictions_select_own` restricts a plain select to the caller's own
  // rows, so a cross-user aggregate can't be built from a plain client query
  // — same reasoning as get_public_profiles / get_fantasy_league_leaderboard.
  // get_predictions_leaderboard (SECURITY DEFINER) exposes only the narrow
  // aggregate needed: profile_id + username + display_name + summed points
  // over scored predictions (points_awarded is null until an admin-triggered
  // scoring pass resolves a fixture). With no scored predictions yet, this
  // resolves to an empty list and the component shows an honest empty state.
  const { data: leaderboardRows } = await supabase.rpc("get_predictions_leaderboard", { p_limit: 20 });

  const leaderboardEntries: LeaderboardEntry[] = (leaderboardRows ?? []).map((row) => ({
    profileId: row.profile_id,
    name: row.display_name || row.username || "Unknown",
    username: row.username ?? null,
    points: row.total_points,
  }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Predictions</h1>
          <p className="text-sm text-foreground-muted">Pick an outcome before kickoff. Predictions lock the moment a match starts.</p>
        </div>
        <Link
          href="/predictions/mine"
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:text-accent/80"
        >
          My predictions
          <ArrowRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </FadeIn>

      <div className="flex flex-col gap-3">
        {fixtures.map((fixture, index) => (
          <FadeIn key={fixture.id} delay={staggerDelay(index, 0.03)}>
            <PredictionCard
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
              consensus={consensusByFixture.get(fixture.id) ?? null}
            />
          </FadeIn>
        ))}
      </div>

      <FadeIn delay={0.35}>
        <PredictionsLeaderboard entries={leaderboardEntries} viewerProfileId={profile?.id ?? null} />
      </FadeIn>
    </div>
  );
}
