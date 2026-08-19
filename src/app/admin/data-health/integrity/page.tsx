import { ShieldCheck, Trophy, ArrowLeftRight, Sparkles, Wrench } from "lucide-react";
import { DISPLAY_LOCALE } from "@/lib/format";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { FadeIn } from "@/components/ui/fade-in";
import { staggerDelay } from "@/lib/stagger";
import { LocalDateTime } from "@/components/ui/relative-time";
import { CORRECT_PREDICTION_POINTS, CORRECT_PREDICTION_XP } from "@/lib/predictions";
import { SCORING_RULES_SUMMARY } from "@/lib/fantasy-scoring";
import { ScorePredictionsButton } from "@/components/admin/score-predictions-button";
import { ScoreFantasyGameweekButton } from "@/components/admin/score-fantasy-gameweek-button";
import { ReconcileTransfersButton } from "@/components/admin/reconcile-transfers-button";
import { SyncPlannerPanel } from "@/components/admin/sync-planner-panel";
import { DataQualityPanel } from "@/components/admin/data-quality-panel";
import { TeamMergePanel } from "@/components/admin/team-merge-panel";
import { FantasyGameweekGenerator } from "@/components/admin/fantasy-gameweek-generator";
import { AdminPageHeader, AdminSection, AdminAccessNotice } from "@/components/admin/admin-chrome";
import { AdminSectionTabs } from "@/components/admin/admin-section-tabs";

/**
 * Football data → Integrity. Is what arrived correct and complete, and what
 * fixes it?
 *
 * Provider says what the provider will serve, Coverage says what KIVO is aimed
 * at, Pipeline says whether the runs happened. This page is the only one that
 * looks at the rows themselves and at the work KIVO does *on top* of them —
 * gaps that will show as empty tabs tomorrow, quality signals, the two scoring
 * engines that turn synced football into points, and the two repairs (transfer
 * reconciliation, club merge) that close specific known defects.
 *
 * Every number here is a count of real rows. Nothing on this page spends
 * provider quota to display; the two scoring buttons and the reconciliation
 * button spend none either — they read KIVO's own database.
 */

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function IntegrityPage() {
  const profile = await getOrCreateProfile();

  if (!canManageFootballData(profile?.role)) {
    return (
      <AdminAccessNotice
        title="Integrity"
        role={profile?.role}
        subject="Football data"
        because="These checks read and repair the football reference tables, which is limited to the football data, admin and super-admin roles."
      />
    );
  }

  const supabase = createServerSupabaseClient();

  /**
   * Three real numbers off the `predictions` table, not one.
   *
   * The single "awaiting scoring" count conflated two states that mean opposite
   * things, because `points_awarded is null` is true both for a row nothing has
   * looked at yet *and* for a row KIVO has examined and honestly declined to
   * settle. So a fixture whose events were never synced showed up as work
   * pending forever, and pressing the button changed the number by nothing —
   * which reads as a broken job rather than as the data gap it is.
   *
   * `lastSettledAt` is the one that answers the question this section exists
   * for: not "is settlement configured" but "has it actually run". The daily
   * sync now calls the same engine the button does, so a timestamp older than a
   * day means the schedule is not reaching it, regardless of what any
   * environment variable says.
   *
   * predictions_select_own means an admin's own client can't see other users'
   * rows, so these counts (like the scoring pass itself) go through the
   * service-role client — read-only here, just to show an honest number rather
   * than making the button a mystery click.
   */
  const predictionService = createServiceRoleSupabaseClient();
  const finishedPredictions = () =>
    predictionService
      .from("predictions")
      .select("id, fixture:fixtures!inner(status)", { count: "exact", head: true })
      .eq("fixture.status", "finished");

  const [awaitingResult, unresolvableResult, settledResult, lastSettledResult] = await Promise.all([
    finishedPredictions().is("resolution", null),
    finishedPredictions().eq("resolution", "unresolvable"),
    finishedPredictions().not("points_awarded", "is", null),
    predictionService
      .from("predictions")
      .select("resolved_at")
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const unscoredPredictions = awaitingResult.count ?? 0;
  const unresolvablePredictions = unresolvableResult.count ?? 0;
  const settledPredictions = settledResult.count ?? 0;
  const lastSettledAt = lastSettledResult.data?.resolved_at ?? null;

  // RECOMMENDATIONS.md item 64: transfers is public-read, so a plain client is
  // enough here (unlike the prediction counts above, which need owner-only RLS
  // bypassed). Two separate head-count queries rather than one OR'd query so the
  // number shown is honestly "rows this button can help", not conflated with rows
  // that are unresolved for some other reason.
  const [{ count: unresolvedFromCount }, { count: unresolvedToCount }] = await Promise.all([
    supabase
      .from("transfers")
      .select("id", { count: "exact", head: true })
      .is("from_team_id", null)
      .not("from_team_provider_id", "is", null),
    supabase
      .from("transfers")
      .select("id", { count: "exact", head: true })
      .is("to_team_id", null)
      .not("to_team_provider_id", "is", null),
  ]);
  const unresolvedTransferSides = (unresolvedFromCount ?? 0) + (unresolvedToCount ?? 0);

  // fantasy_gameweeks is public-read, but fantasy_points is owner-only RLS
  // (fantasy_points_select_own) — a plain client can't see whether other
  // teams' gameweeks have been scored, so that check goes through the
  // service-role client, same rationale as the prediction counts above.
  const { data: recentGameweeks } = await supabase
    .from("fantasy_gameweeks")
    .select("id, number, deadline_at, is_current, season:seasons(name, competition:competitions(short_name, name))")
    .order("deadline_at", { ascending: false })
    .limit(8);

  const gameweekIds = (recentGameweeks ?? []).map((gameweek) => gameweek.id);
  let scoredGameweekIds = new Set<string>();
  if (gameweekIds.length > 0) {
    const { data: pointsRows } = await predictionService
      .from("fantasy_points")
      .select("gameweek_id")
      .in("gameweek_id", gameweekIds);
    scoredGameweekIds = new Set((pointsRows ?? []).map((row) => row.gameweek_id));
  }

  // KN-83: the club list for the merge tool. Bounded — a merge is a targeted
  // repair, not a bulk operation, and a select of every club in a fully-synced
  // database would be unusable anyway.
  const { data: mergeableTeamRows } = await supabase
    .from("teams")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(200);

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionTabs groupId="football-data" />

      <AdminPageHeader
        icon={ShieldCheck}
        title="Integrity"
        lede="What is missing, what disagrees, and what KIVO computes on top of it. The gaps here are the ones a reader will meet as an empty tab tomorrow."
        cost="Nothing on this page spends provider quota — to display it or to press it. Every count and every repair reads KIVO's own database."
      />

      <SyncPlannerPanel />

      <DataQualityPanel />

      <AdminSection
        icon={Sparkles}
        title="Scoring jobs"
        note="The two engines that turn synced football into points. Both run automatically — these buttons are for after a manual correction, not instead of the schedule."
        delay={0.06}
      >
        <FadeIn
          delay={0.07}
          className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                unscoredPredictions > 0 ? "bg-warning/15" : "bg-surface-2"
              }`}
            >
              <Trophy
                className={`h-5 w-5 ${unscoredPredictions > 0 ? "text-warning" : "text-foreground-subtle"}`}
                strokeWidth={1.75}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {unscoredPredictions > 0
                  ? `${unscoredPredictions} prediction${unscoredPredictions === 1 ? "" : "s"} awaiting scoring`
                  : "All predictions are scored"}
              </p>
              <p className="text-xs text-foreground-subtle">
                {settledPredictions} settled · {unscoredPredictions} awaiting · {unresolvablePredictions} unresolvable.{" "}
                {lastSettledAt ? (
                  <>
                    Last run <LocalDateTime iso={lastSettledAt} format="dayTime" />.
                  </>
                ) : (
                  <>Never run.</>
                )}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground-subtle">
                Scores all six prediction types against real, already-synced data: final scores, match events, team
                statistics and the Room&apos;s own man-of-the-match vote. A winner pick earns{" "}
                {CORRECT_PREDICTION_POINTS} points and {CORRECT_PREDICTION_XP} XP; harder types earn more.{" "}
                <span className="text-warning">Unresolvable</span> means the data a type needs was never synced —
                those are left explicitly unsettled and cost the user nothing, rather than being marked wrong.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <ScorePredictionsButton />
          </div>
        </FadeIn>

        <FadeIn delay={0.08} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Fantasy gameweeks</h3>
            <span className="flex items-center gap-1 text-[11px] text-foreground-subtle">
              <ShieldCheck className="h-3 w-3" strokeWidth={2} />
              {SCORING_RULES_SUMMARY.length} published rules
            </span>
          </div>

          {!recentGameweeks || recentGameweeks.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              No fantasy gameweeks exist yet. Derive them from a season&apos;s synced fixtures below.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentGameweeks.map((gameweek, index) => {
                const seasonLabel = [
                  gameweek.season?.competition?.short_name ?? gameweek.season?.competition?.name,
                  gameweek.season?.name,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const scored = scoredGameweekIds.has(gameweek.id);
                return (
                  <FadeIn
                    key={gameweek.id}
                    delay={0.09 + staggerDelay(index, 0.03)}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-1 p-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">GW{gameweek.number}</span>
                        {seasonLabel ? ` · ${seasonLabel}` : ""}
                        {gameweek.is_current && (
                          <span className="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                            Current
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-foreground-subtle">
                        Deadline {formatTimestamp(gameweek.deadline_at)}
                        {" · "}
                        {scored ? "Already scored (re-run to refresh)" : "Not scored yet"}
                      </p>
                    </div>
                    <ScoreFantasyGameweekButton gameweekId={gameweek.id} />
                  </FadeIn>
                );
              })}
            </div>
          )}

          <FantasyGameweekGenerator />

          <details className="text-xs text-foreground-subtle">
            <summary className="kivo-focusable inline-flex min-h-9 cursor-pointer items-center rounded-lg font-medium text-foreground-muted">
              Published scoring rules
            </summary>
            <ul className="mt-2 flex flex-col gap-1 pl-1">
              {SCORING_RULES_SUMMARY.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </details>
        </FadeIn>
      </AdminSection>

      <AdminSection
        icon={Wrench}
        title="Repairs"
        note="Two targeted fixes for two known defects. Neither is a bulk operation and neither spends provider quota."
        delay={0.11}
      >
        {/* RECOMMENDATIONS.md item 64: resolveTeamId in sync-transfers.ts leaves
            from_team_id/to_team_id null for a club KIVO hadn't synced yet at the
            time — this surfaces how many transfer sides are still sitting like
            that, and the zero-quota reconciliation pass that can revisit them now
            that more teams may have been synced since. */}
        <FadeIn
          delay={0.12}
          className="kivo-glass flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                unresolvedTransferSides > 0 ? "bg-warning/15" : "bg-surface-2"
              }`}
            >
              <ArrowLeftRight
                className={`h-5 w-5 ${unresolvedTransferSides > 0 ? "text-warning" : "text-foreground-subtle"}`}
                strokeWidth={1.75}
              />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {unresolvedTransferSides > 0
                  ? `${unresolvedTransferSides} transfer side${unresolvedTransferSides === 1 ? "" : "s"} showing “Club not synced”`
                  : "All synced transfers have resolved clubs"}
              </p>
              <p className="text-xs leading-relaxed text-foreground-subtle">
                Re-checks provider_mappings for clubs that weren&apos;t synced yet when their transfer was recorded.
                No provider quota spent.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <ReconcileTransfersButton />
          </div>
        </FadeIn>

        {/* KIVO_NEXT_GEN KN-83. Kept beside the other repair rather than on a
            screen of its own — it fixes one specific condition (the same real
            club synced twice under two providers), and burying it somewhere
            separate would make it something nobody finds when they need it. */}
        <TeamMergePanel teams={mergeableTeamRows ?? []} />
      </AdminSection>
    </div>
  );
}
