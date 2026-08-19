import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { LoadFailed } from "@/components/ui/load-failed";
import { readList } from "@/lib/query-result";
import { PredictionCard, type PredictionConsensus } from "@/components/predictions/prediction-card";
import { PredictionsLeaderboard, type LeaderboardEntry } from "@/components/predictions/predictions-leaderboard";
import { getNavItem } from "@/lib/navigation";
import { staggerDelay } from "@/lib/stagger";
import { competitionName } from "@/lib/football/competition-label";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import { PredictionLeaguesPanel } from "@/components/predictions/prediction-leagues-panel";
import {
  getMyPredictionLeagues,
  getPredictionLeagueStandings,
  type PredictionLeagueStanding,
} from "@/lib/prediction-leagues";

const item = getNavItem("predictions");

export const metadata: Metadata = { title: item.label };

export default async function PredictionsPage() {
  const profile = await getOrCreateProfile();

  // KN-104. Fetched here rather than inside the panel so the standings arrive
  // with the first paint — a league table that pops in after the page has
  // settled reads as a loading bug on a surface whose whole point is a table.
  const myLeagues = profile ? await getMyPredictionLeagues(profile.id) : [];
  const standingsByLeague: Record<string, PredictionLeagueStanding[]> = {};
  for (const league of myLeagues) {
    standingsByLeague[league.id] = await getPredictionLeagueStandings(league.id);
  }
  const supabase = createServerSupabaseClient();

  const fixturesOutcome = readList(
    await supabase
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
      .limit(20),
    "predictions.upcomingFixtures",
  );

  if (fixturesOutcome.failed) {
    return (
      <LoadFailed
        title={item.label}
        icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />}
        description="KIVO couldn't read the upcoming fixtures just now, so it can't offer you anything to call. Try again."
      />
    );
  }

  const fixtures = fixturesOutcome.rows;

  if (fixtures.length === 0) {
    return (
      <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.emptyDescription ?? "Nothing to show here yet."} />
    );
  }

  const fixtureIds = fixtures.map((f) => f.id);
  const existingPredictionsOutcome = readList(
    profile
      ? await supabase
          .from("predictions")
          .select("fixture_id, predicted_outcome")
          .eq("profile_id", profile.id)
          .in("fixture_id", fixtureIds)
      : { data: [], error: null },
    "predictions.ownPicks",
  );

  // Gated, unlike the consensus bar and the leaderboard below it. A failed
  // read here does not leave a card looking incomplete — it leaves every card
  // looking un-picked, which invites the reader to make a prediction they
  // already made. The rest of this page is decoration by comparison.
  if (existingPredictionsOutcome.failed) {
    return (
      <LoadFailed
        title={item.label}
        icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />}
        description="KIVO couldn't read the calls you've already made, and showing these matches as un-picked would invite you to make them twice. Try again."
      />
    );
  }

  const predictionByFixture = new Map(
    existingPredictionsOutcome.rows.map((p) => [p.fixture_id, p.predicted_outcome]),
  );

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
              competitionName={competitionName(fixture.competition, "short")}
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
              signedIn={viewerIsSignedIn(profile)}
              consensus={consensusByFixture.get(fixture.id) ?? null}
            />
          </FadeIn>
        ))}
      </div>

      <FadeIn delay={0.35}>
        <PredictionsLeaderboard entries={leaderboardEntries} viewerProfileId={profile?.id ?? null} />
      </FadeIn>

      {/* KIVO_NEXT_GEN KN-104. The global leaderboard answers "how am I doing
          against everyone"; a prediction league answers "how am I doing against
          the six people I actually argue with", which is the one people come
          back for. Signed-in only — there is no league to belong to otherwise. */}
      {profile && (
        <FadeIn delay={0.4}>
          <PredictionLeaguesPanel leagues={myLeagues} standingsByLeague={standingsByLeague} />
        </FadeIn>
      )}
    </div>
  );
}
