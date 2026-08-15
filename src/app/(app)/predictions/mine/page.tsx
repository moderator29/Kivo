import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Target, CheckCircle2, XCircle, Clock, MinusCircle } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { staggerDelay } from "@/lib/stagger";
import type { FixtureStatus } from "@/lib/football/fixture-status";
import { PREDICTION_OUTCOME_LABEL, computeStreaks } from "@/lib/predictions";

export const metadata: Metadata = { title: "My Predictions" };

/**
 * A prediction's result, purely from real columns — `points_awarded` is null
 * until the admin scoring pass (predictions-actions.ts's scorePredictions)
 * resolves it, so "not scored yet" is shown honestly rather than as a 0 or a
 * guessed outcome. Never derives correctness from the fixture score directly:
 * `points_awarded` is the single source of truth for what was actually
 * graded, same as the leaderboard.
 */
function resultInfo(status: FixtureStatus, pointsAwarded: number | null) {
  if (pointsAwarded !== null) {
    return pointsAwarded > 0
      ? { label: `Correct · +${pointsAwarded} pts`, className: "text-live", icon: CheckCircle2 }
      : { label: "Incorrect", className: "text-critical", icon: XCircle };
  }
  if (status === "finished") {
    return { label: "Not scored yet", className: "text-foreground-subtle", icon: Clock };
  }
  if (status === "postponed" || status === "cancelled" || status === "abandoned") {
    return { label: "No result", className: "text-foreground-subtle", icon: MinusCircle };
  }
  return { label: "Pending", className: "text-foreground-subtle", icon: Clock };
}

export default async function MyPredictionsPage() {
  const profile = await getOrCreateProfile();

  // Separate server-rendered route, so gate with a plain inline sign-in
  // prompt (matching /profile's guest view) rather than a client redirect —
  // `predictions_select_own` means there is nothing real to show a guest here.
  if (!profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <Target className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign in to see your prediction history and record.</p>
        <Link
          href={`/sign-up?redirect_url=${encodeURIComponent("/predictions/mine")}`}
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  // predictions_select_own already restricts this to the caller's own rows,
  // so a plain query (no RPC) is enough for a full, honest history.
  const { data: predictionRows } = await supabase
    .from("predictions")
    .select(
      `id, predicted_outcome, points_awarded, created_at,
       fixture:fixtures(
         id, kickoff_at, status, home_score, away_score,
         home_team:teams!fixtures_home_team_id_fkey(id, name, crest_url),
         away_team:teams!fixtures_away_team_id_fkey(id, name, crest_url),
         competition:competitions(name, short_name)
       )`,
    )
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  // `fixture_id` cascades on fixture delete (RECOMMENDATIONS item 47), so this
  // should never actually be null in practice — filtered defensively anyway
  // rather than rendering a broken row.
  const rows = (predictionRows ?? []).filter((row) => row.fixture !== null);

  const scoredRows = rows.filter((row) => row.points_awarded !== null);
  const correctCount = scoredRows.filter((row) => (row.points_awarded ?? 0) > 0).length;
  const accuracyPct = scoredRows.length > 0 ? Math.round((correctCount / scoredRows.length) * 100) : null;

  // RECOMMENDATIONS.md item 169: real streaks derived from this same scored
  // history, ordered by each prediction's fixture kickoff_at (see
  // computeStreaks' own comment for why that's the right axis, not
  // created_at).
  const streaks =
    scoredRows.length > 0
      ? computeStreaks(
          scoredRows.map((row) => ({ pointsAwarded: row.points_awarded ?? 0, kickoffAt: row.fixture!.kickoff_at })),
        )
      : null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="flex flex-col gap-1">
        <Link
          href="/predictions"
          className="flex items-center gap-1 text-xs text-foreground-subtle hover:text-foreground-muted"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={2} />
          Back to predictions
        </Link>
        <h1 className="text-xl font-semibold text-foreground">My Predictions</h1>
        <p className="text-sm text-foreground-subtle">Your prediction history and record.</p>
      </FadeIn>

      {rows.length === 0 ? (
        <FadeIn delay={0.05} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <Target className="h-6 w-6 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            You haven&apos;t made any predictions yet. Pick an outcome on an upcoming fixture to start your record.
          </p>
          <Link
            href="/predictions"
            className="kivo-gradient-prime rounded-xl px-4 py-2 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
          >
            Make a prediction
          </Link>
        </FadeIn>
      ) : (
        <>
          <FadeIn delay={0.05} className="kivo-glass-brand grid grid-cols-3 gap-2 rounded-2xl p-5 text-center">
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-semibold text-foreground">{rows.length}</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                Predictions
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-semibold text-foreground">{correctCount}</span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">Correct</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-2xl font-semibold text-foreground">
                {accuracyPct !== null ? `${accuracyPct}%` : "-"}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">Accuracy</span>
            </div>
          </FadeIn>

          {streaks && (
            <FadeIn delay={0.08} className="grid grid-cols-2 gap-2 text-center">
              <div className="kivo-glass flex flex-col gap-0.5 rounded-2xl p-4">
                <span className="text-2xl font-semibold text-foreground">{streaks.current}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                  Current streak
                </span>
              </div>
              <div className="kivo-glass flex flex-col gap-0.5 rounded-2xl p-4">
                <span className="text-2xl font-semibold text-foreground">{streaks.best}</span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                  Best streak
                </span>
              </div>
            </FadeIn>
          )}

          {scoredRows.length < rows.length && (
            <p className="-mt-3 text-center text-xs text-foreground-subtle">
              {scoredRows.length === 0
                ? "None of your predictions have been scored yet."
                : `${scoredRows.length} of ${rows.length} scored so far.`}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {rows.map((row, index) => {
              const fixture = row.fixture!;
              const competitionName = fixture.competition?.short_name ?? fixture.competition?.name ?? "Unknown competition";
              const hasScore = fixture.home_score !== null && fixture.away_score !== null;
              const result = resultInfo(fixture.status, row.points_awarded);
              const ResultIcon = result.icon;

              return (
                <FadeIn key={row.id} delay={0.1 + staggerDelay(index, 0.03)}>
                  <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-foreground-subtle">{competitionName}</span>
                      <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoff_at} />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <TeamCrest crestUrl={fixture.home_team?.crest_url ?? null} name={fixture.home_team?.name ?? "Home"} />
                        {fixture.home_team?.id ? (
                          <Link
                            href={`/teams/${fixture.home_team.id}`}
                            className="truncate text-sm text-foreground hover:text-kivo-cyan"
                          >
                            {fixture.home_team.name}
                          </Link>
                        ) : (
                          <span className="truncate text-sm text-foreground">{fixture.home_team?.name ?? "Home team"}</span>
                        )}
                      </div>
                      <span
                        className={`shrink-0 text-xs font-semibold ${hasScore ? "text-foreground" : "text-foreground-subtle"}`}
                      >
                        {hasScore ? `${fixture.home_score} – ${fixture.away_score}` : "vs"}
                      </span>
                      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                        {fixture.away_team?.id ? (
                          <Link
                            href={`/teams/${fixture.away_team.id}`}
                            className="truncate text-right text-sm text-foreground hover:text-kivo-cyan"
                          >
                            {fixture.away_team.name}
                          </Link>
                        ) : (
                          <span className="truncate text-right text-sm text-foreground">
                            {fixture.away_team?.name ?? "Away team"}
                          </span>
                        )}
                        <TeamCrest crestUrl={fixture.away_team?.crest_url ?? null} name={fixture.away_team?.name ?? "Away"} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                      <span className="text-xs text-foreground-muted">
                        You picked{" "}
                        <span className="font-semibold text-foreground">
                          {PREDICTION_OUTCOME_LABEL[row.predicted_outcome]}
                        </span>
                      </span>
                      <span className={`flex shrink-0 items-center gap-1 text-xs font-medium ${result.className}`}>
                        <ResultIcon className="h-3.5 w-3.5" strokeWidth={2} />
                        {result.label}
                      </span>
                    </div>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
