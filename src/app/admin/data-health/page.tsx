import { Database, Lock, CheckCircle2, XCircle, Loader2, MinusCircle, CircleSlash, Trophy, Activity, ShieldCheck, ListChecks, Clock3, ArrowLeftRight, RadioTower } from "lucide-react";
import { DISPLAY_LOCALE, formatNumber } from "@/lib/format";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { getActiveProviderStatus } from "@/lib/football";
import { FadeIn } from "@/components/ui/fade-in";
import { staggerDelay } from "@/lib/stagger";
import { FootballSyncButton } from "@/components/admin/football-sync-button";
import { ScorePredictionsButton } from "@/components/admin/score-predictions-button";
import { ScoreFantasyGameweekButton } from "@/components/admin/score-fantasy-gameweek-button";
import { PruneSyncRunsButton } from "@/components/admin/prune-sync-runs-button";
import { ReconcileTransfersButton } from "@/components/admin/reconcile-transfers-button";
import { DataQualityPanel } from "@/components/admin/data-quality-panel";
import { SyncReliabilityPanel } from "@/components/admin/sync-reliability-panel";
import { AutomationStatusPanel } from "@/components/admin/automation-status-panel";
import { SyncPlannerPanel } from "@/components/admin/sync-planner-panel";
import { CORRECT_PREDICTION_POINTS, CORRECT_PREDICTION_XP } from "@/lib/predictions";
import { SCORING_RULES_SUMMARY } from "@/lib/fantasy-scoring";
import type { Database as DatabaseType } from "@/lib/supabase/types";
import { TeamMergePanel } from "@/components/admin/team-merge-panel";

type SyncStatus = DatabaseType["public"]["Enums"]["sync_status"];

const STATUS_STYLE: Record<SyncStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  success: { icon: CheckCircle2, className: "border-live/30 bg-live/10 text-live", label: "Success" },
  partial: { icon: MinusCircle, className: "border-warning/30 bg-warning/10 text-warning", label: "Partial" },
  failed: { icon: XCircle, className: "border-critical/30 bg-critical/10 text-critical", label: "Failed" },
  running: { icon: Loader2, className: "border-hairline text-foreground-subtle", label: "Running" },
  // migration 0044: the cron worker's own no-op decisions (flag off, nothing
  // live, dedup hit, quota floor) — genuinely not one of the four statuses
  // above, since no provider call was ever attempted. See
  // src/app/api/cron/sync-live/route.ts.
  skipped: { icon: CircleSlash, className: "border-hairline bg-surface-1 text-foreground-subtle", label: "Skipped" },
};

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString(DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * RECOMMENDATIONS.md item 61: the sync dependency chain (fixtures unlock
 * everything else) is otherwise only discoverable by reading error strings
 * like "Sync its competition's fixtures first" (sync-squads.ts) or "Sync its
 * fixtures first" (sync-match-details.ts's syncStandings) after a sync
 * already failed. Documented here as an ordered checklist instead, matching
 * exactly what each sync function actually requires — see the "Requires"
 * column's cross-reference to the real guard in each src/lib/football/*.ts
 * file.
 */
const SYNC_ORDER_STEPS: { title: string; where: string; requires: string }[] = [
  {
    title: "1. Sync today's fixtures",
    where: '"Sync now" above',
    requires: "Nothing — this is the entry point. Creates KIVO's competitions, teams, venues and fixtures, each mapped to their provider id.",
  },
  {
    title: "2. Sync a team's squad",
    where: "that team's profile page",
    requires: "Step 1 first, for a fixture involving that team — a team with no provider mapping yet can't be squad-synced (sync-squads.ts).",
  },
  {
    title: "3. Sync a season's standings",
    where: "that competition's league page",
    requires: "Step 1 first, for a fixture in that competition — standings need the competition's provider mapping (sync-match-details.ts).",
  },
  {
    title: "4. Sync a player's transfer history",
    where: "that player's profile page",
    requires: "Step 2 first, for that player's team — a player only gets a provider mapping via a squad sync (sync-transfers.ts).",
  },
  {
    title: "5. Sync a fixture's lineups, events, and stats",
    where: "that fixture's Match Centre",
    requires: "Step 1 first, for that fixture. A side with no squad synced yet has its lineup entries skipped, not auto-synced, unless squad auto-sync is opted into on the fixture's own sync control (RECOMMENDATIONS.md item 59) — that's an extra provider call per unseen team, so it's off by default.",
  },
];

/** RECOMMENDATIONS.md item 62: getFootballDataProvider() only ever runs inside
 * these admin-triggered sync actions (never a public page's render path — see
 * src/lib/football/index.ts and its only callers), so a 429 from API-Football
 * surfaces here, not on a public page. classifyHttpError() in
 * api-football-request.ts already writes an explicit "daily quota exhausted"
 * message into error_message; this just recognizes that text to show a calmer,
 * plain-language summary above the raw technical line instead of only red
 * "failed" styling. */
function isQuotaExhaustedMessage(message: string): boolean {
  return message.includes("quota exhausted");
}

export default async function DataHealthPage() {
  const profile = await getOrCreateProfile();

  if (!canManageFootballData(profile?.role)) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold text-foreground">Data health</h1>
        <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Lock className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            Football data isn&apos;t part of your role (<span className="text-foreground">{profile?.role}</span>).
            This isn&apos;t empty, it&apos;s outside what your access covers.
          </p>
        </div>
      </div>
    );
  }

  // Honest per this platform's zero-fake-data rule: the mock provider never counts as
  // "connected" here, even in dev — it exists only so UI can be built without spending
  // real provider quota. getActiveProviderStatus() mirrors getFootballDataProvider()'s
  // own selection order (src/lib/football/index.ts) so this banner never claims a
  // provider is connected that the app wouldn't actually construct — e.g.
  // FOOTBALL_DATA_PROVIDER=thesportsdb with only API_FOOTBALL_KEY set correctly still
  // reads as API-Football here, since that's genuinely what getFootballDataProvider()
  // would fall back to. Also reused by the Admin Overview stat card so the two pages
  // can never disagree about whether a provider is connected.
  const { name: activeProviderName, label: activeProviderLabelOrNull } = getActiveProviderStatus();
  const providerConfigured = activeProviderName !== null;
  const activeProviderLabel = activeProviderLabelOrNull ?? "API-Football";

  const supabase = createServerSupabaseClient();

  // KN-83: the club list for the merge tool. Bounded — a merge is a targeted
  // repair, not a bulk operation, and a select of every club in a
  // fully-synced database would be unusable anyway.
  const { data: mergeableTeamRows } = await supabase
    .from("teams")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(200);
  const mergeableTeams = mergeableTeamRows ?? [];
  // trigger_source (migration 0044) scopes this to admin-clicked runs only —
  // the automated cron worker gets its own "Automated worker" section below
  // instead of crowding this list out. Vercel Cron fires the worker's route
  // once a minute once deployed, so without this filter a single manual sync
  // from days ago would already have scrolled off this capped 10-row list.
  const { data: syncRuns } = await supabase
    .from("sync_runs")
    .select(
      "id, provider, entity_type, status, started_at, finished_at, records_processed, error_message, provider_quota_remaining",
    )
    .eq("trigger_source", "manual")
    .order("started_at", { ascending: false })
    .limit(10);

  // The automated worker's own recent history — every firing, including every
  // no-op decision (see src/app/api/cron/sync-live/route.ts's module doc
  // comment). Kept separate from syncRuns above so an admin can see "is the
  // worker actually firing, and what did it decide" without it displacing
  // manual sync history, and vice versa.
  const { data: cronRuns } = await supabase
    .from("sync_runs")
    .select("id, status, started_at, finished_at, records_processed, error_message, provider_quota_remaining")
    .eq("trigger_source", "cron")
    .order("started_at", { ascending: false })
    .limit(8);
  const latestCronRun = cronRuns?.[0] ?? null;
  // Vercel Cron fires this worker every minute (vercel.json) — a real gap
  // meaningfully longer than that between "now" and the worker's last known
  // check-in means either it isn't deployed/configured correctly, or (for a
  // very fresh deploy) the first minute just hasn't ticked over yet. 5x the
  // 1-minute schedule is a deliberately generous margin against ordinary
  // scheduling jitter/cold starts before this warns anyone.
  const CRON_STALE_THRESHOLD_MINUTES = 5;
  const cronMinutesSinceLastRun = latestCronRun ? (new Date().getTime() - new Date(latestCronRun.started_at).getTime()) / 60_000 : null;
  const cronWorkerIsStale = cronMinutesSinceLastRun !== null && cronMinutesSinceLastRun > CRON_STALE_THRESHOLD_MINUTES;

  // RECOMMENDATIONS.md item 53: the provider's own x-ratelimit-requests-remaining
  // header, persisted on whichever sync_runs row last saw a response — real data,
  // not an estimate. Read separately from the capped 10-row list above since the
  // most recent run with a known quota isn't necessarily within the last 10 (a run
  // that failed before any provider call leaves this column null).
  const { data: latestQuotaRun } = await supabase
    .from("sync_runs")
    .select("provider_quota_remaining, started_at")
    .not("provider_quota_remaining", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // predictions_select_own means an admin's own client can't see other
  // users' rows, so this count (like the scoring pass itself) goes through
  // the service-role client — read-only here, just to show an honest number
  // rather than making the button a mystery click.
  const { data: finishedFixtures } = await supabase
    .from("fixtures")
    .select("id")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null);
  const finishedFixtureIds = (finishedFixtures ?? []).map((f) => f.id);
  let unscoredPredictions = 0;
  if (finishedFixtureIds.length > 0) {
    const service = createServiceRoleSupabaseClient();
    const { count } = await service
      .from("predictions")
      .select("id", { count: "exact", head: true })
      .in("fixture_id", finishedFixtureIds)
      .is("points_awarded", null);
    unscoredPredictions = count ?? 0;
  }

  // RECOMMENDATIONS.md item 64: transfers is public-read, so a plain client is
  // enough here (unlike unscoredPredictions above, which needs owner-only RLS
  // bypassed). Two separate head-count queries rather than one OR'd query so the
  // number shown is honestly "rows this button can help", not conflated with rows
  // that are unresolved for some other reason.
  const { count: unresolvedFromCount } = await supabase
    .from("transfers")
    .select("id", { count: "exact", head: true })
    .is("from_team_id", null)
    .not("from_team_provider_id", "is", null);
  const { count: unresolvedToCount } = await supabase
    .from("transfers")
    .select("id", { count: "exact", head: true })
    .is("to_team_id", null)
    .not("to_team_provider_id", "is", null);
  const unresolvedTransferSides = (unresolvedFromCount ?? 0) + (unresolvedToCount ?? 0);

  // fantasy_gameweeks is public-read, but fantasy_points is owner-only RLS
  // (fantasy_points_select_own) — a plain client can't see whether other
  // teams' gameweeks have been scored, so that check goes through the
  // service-role client, same rationale as unscoredPredictions above.
  const { data: recentGameweeks } = await supabase
    .from("fantasy_gameweeks")
    .select("id, number, deadline_at, is_current, season:seasons(name, competition:competitions(short_name, name))")
    .order("deadline_at", { ascending: false })
    .limit(8);

  const gameweekIds = (recentGameweeks ?? []).map((g) => g.id);
  let scoredGameweekIds = new Set<string>();
  if (gameweekIds.length > 0) {
    const service = createServiceRoleSupabaseClient();
    const { data: pointsRows } = await service.from("fantasy_points").select("gameweek_id").in("gameweek_id", gameweekIds);
    scoredGameweekIds = new Set((pointsRows ?? []).map((p) => p.gameweek_id));
  }

  // Data Health's own list below only ever shows the last 10 runs — this is
  // the only place any run-level aggregate exists, so it goes over every
  // sync_runs row rather than reusing that capped list. status/records_processed
  // for the overall totals below, plus started_at/provider_quota_remaining for
  // today's quota trend (RECOMMENDATIONS.md item 213).
  const { data: allRuns } = await supabase
    .from("sync_runs")
    .select("status, records_processed, started_at, provider_quota_remaining");
  const totalRuns = allRuns?.length ?? 0;
  const successfulRuns = (allRuns ?? []).filter((r) => r.status === "success").length;
  const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : null;
  const totalRecordsProcessed = (allRuns ?? []).reduce((sum, r) => sum + (r.records_processed ?? 0), 0);

  // Today's quota trend: API-Football's quota resets daily and only counts down
  // as syncs run, so the highest reading seen today is the best available proxy
  // for "what today started with" and the lowest is the most depleted (most
  // recent) reading — both real values off provider_quota_remaining, never
  // estimated. Matches todayIsoDate()'s UTC-day boundary in
  // src/lib/football/sync.ts.
  const todayIso = new Date().toISOString().slice(0, 10);
  const todaysQuotaReadings = (allRuns ?? [])
    .filter(
      (r): r is typeof r & { provider_quota_remaining: number } =>
        r.provider_quota_remaining !== null && r.started_at?.slice(0, 10) === todayIso,
    )
    .map((r) => r.provider_quota_remaining);
  const quotaUsedToday =
    todaysQuotaReadings.length > 0 ? Math.max(...todaysQuotaReadings) - Math.min(...todaysQuotaReadings) : null;

  return (
    <div className="flex flex-col gap-8">
      <FadeIn className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Data health</h1>
        <p className="text-sm text-foreground-muted">Football data provider status and sync jobs.</p>
      </FadeIn>

      <FadeIn delay={0.08} className="kivo-glass-brand flex items-center justify-between gap-4 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              providerConfigured ? "bg-live/15" : "bg-surface-2"
            }`}
          >
            <Database className={`h-5 w-5 ${providerConfigured ? "text-live" : "text-foreground-subtle"}`} strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {providerConfigured ? `${activeProviderLabel} connected` : "No provider connected"}
            </p>
            <p className="text-xs text-foreground-subtle">
              {providerConfigured
                ? activeProviderName === "thesportsdb"
                  ? "FOOTBALL_DATA_PROVIDER=thesportsdb and THE_SPORTS_DB_API_KEY are set. Some sync actions (lineups, events, stats, manager, transfers) aren't supported by this provider — see docs/PROVIDER_ABSTRACTION.md."
                  : "API_FOOTBALL_KEY is set. Sync writes real fixtures via the service-role client."
                : "Set API_FOOTBALL_KEY (or THE_SPORTS_DB_API_KEY + FOOTBALL_DATA_PROVIDER=thesportsdb) to enable syncing. The dev-only mock provider is never used here."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {latestQuotaRun && (
            <span
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                latestQuotaRun.provider_quota_remaining !== null && latestQuotaRun.provider_quota_remaining <= 10
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-hairline text-foreground-muted"
              }`}
              title="API-Football's own x-ratelimit-requests-remaining header from the most recent sync, not an estimate."
            >
              {latestQuotaRun.provider_quota_remaining} request{latestQuotaRun.provider_quota_remaining === 1 ? "" : "s"}{" "}
              left today
            </span>
          )}
          {providerConfigured && <FootballSyncButton />}
        </div>
      </FadeIn>

      <FadeIn delay={0.09} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <ListChecks className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Sync order
        </h2>
        <p className="text-xs text-foreground-subtle">
          Every other sync depends on fixtures having run first. Doing them out of order fails with a &ldquo;no
          provider mapping yet&rdquo; error instead of syncing anything.
        </p>
        <ol className="flex flex-col gap-2.5">
          {SYNC_ORDER_STEPS.map((step) => (
            <li key={step.title} className="flex flex-col gap-0.5 rounded-xl bg-surface-2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">{step.title}</span>
                <span className="shrink-0 text-[11px] text-foreground-subtle">{step.where}</span>
              </div>
              <p className="text-[11px] text-foreground-subtle">{step.requires}</p>
            </li>
          ))}
        </ol>
      </FadeIn>

      <FadeIn delay={0.1} className="kivo-glass-brand flex items-center justify-between gap-4 rounded-2xl p-5">
        <div className="flex items-center gap-3">
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
          <div>
            <p className="text-sm font-semibold text-foreground">
              {unscoredPredictions > 0
                ? `${unscoredPredictions} prediction${unscoredPredictions === 1 ? "" : "s"} awaiting scoring`
                : "All predictions are scored"}
            </p>
            <p className="text-xs text-foreground-subtle">
              Scores all six prediction types against real, already-synced data — final scores, match events, team
              statistics and the Room&apos;s own man-of-the-match vote. A winner pick earns {CORRECT_PREDICTION_POINTS}{" "}
              points and {CORRECT_PREDICTION_XP} XP; harder types earn more. Anything whose underlying data was never
              synced is left explicitly unresolved rather than marked wrong.
            </p>
          </div>
        </div>
        <ScorePredictionsButton />
      </FadeIn>

      {/* RECOMMENDATIONS.md item 64: resolveTeamId in sync-transfers.ts leaves
          from_team_id/to_team_id null for a club KIVO hadn't synced yet at the time —
          this surfaces how many transfer sides are still sitting like that, and the
          zero-quota reconciliation pass that can revisit them now that more teams may
          have been synced since. */}
      <FadeIn delay={0.105} className="kivo-glass-brand flex items-center justify-between gap-4 rounded-2xl p-5">
        <div className="flex items-center gap-3">
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
          <div>
            <p className="text-sm font-semibold text-foreground">
              {unresolvedTransferSides > 0
                ? `${unresolvedTransferSides} transfer side${unresolvedTransferSides === 1 ? "" : "s"} showing "Club not synced"`
                : "All synced transfers have resolved clubs"}
            </p>
            <p className="text-xs text-foreground-subtle">
              Re-checks provider_mappings for clubs that weren&apos;t synced yet when their transfer was recorded. No
              provider quota spent.
            </p>
          </div>
        </div>
        <ReconcileTransfersButton />
      </FadeIn>

      <div className="flex flex-col gap-3">
        <FadeIn delay={0.11} className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Fantasy scoring</h2>
          <span className="flex items-center gap-1 text-[11px] text-foreground-subtle">
            <ShieldCheck className="h-3 w-3" strokeWidth={2} />
            {SCORING_RULES_SUMMARY.length} published rules
          </span>
        </FadeIn>

        {!recentGameweeks || recentGameweeks.length === 0 ? (
          <FadeIn delay={0.12} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No fantasy gameweeks exist yet. Generate gameweeks from a season on the Fantasy page first.
          </FadeIn>
        ) : (
          <div className="flex flex-col gap-2">
            {recentGameweeks.map((gw, index) => {
              const seasonLabel = [gw.season?.competition?.short_name ?? gw.season?.competition?.name, gw.season?.name]
                .filter(Boolean)
                .join(" · ");
              const scored = scoredGameweekIds.has(gw.id);
              return (
                <FadeIn
                  key={gw.id}
                  delay={0.12 + staggerDelay(index, 0.03)}
                  className="kivo-glass flex items-center justify-between gap-3 rounded-xl p-4"
                >
                  <div>
                    <p className="text-sm text-foreground">
                      <span className="font-medium">GW{gw.number}</span>
                      {seasonLabel ? ` · ${seasonLabel}` : ""}
                      {gw.is_current && (
                        <span className="ml-2 rounded-full bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold text-accent">
                          Current
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-foreground-subtle">
                      Deadline {formatTimestamp(gw.deadline_at)}
                      {" · "}
                      {scored ? "Already scored (re-run to refresh)" : "Not scored yet"}
                    </p>
                  </div>
                  <ScoreFantasyGameweekButton gameweekId={gw.id} />
                </FadeIn>
              );
            })}
          </div>
        )}

        <FadeIn delay={0.15} className="kivo-glass rounded-xl p-4 text-xs text-foreground-subtle">
          <p className="mb-1.5 font-semibold text-foreground-muted">Published scoring rules</p>
          <ul className="flex flex-col gap-1">
            {SCORING_RULES_SUMMARY.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </FadeIn>
      </div>

      {totalRuns > 0 && (
        <FadeIn delay={0.13} className="kivo-glass grid grid-cols-2 gap-3 rounded-2xl p-5 sm:grid-cols-4 sm:divide-x sm:divide-hairline-soft">
          <div className="flex flex-col items-center gap-1 text-center">
            <Activity className="h-4 w-4 text-accent" strokeWidth={1.75} />
            <span className="text-lg font-semibold text-foreground">{totalRuns}</span>
            <span className="text-[11px] text-foreground-subtle">Total syncs</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span
              className={`text-lg font-semibold ${
                successRate === null ? "text-foreground" : successRate >= 90 ? "text-live" : successRate >= 60 ? "text-warning" : "text-critical"
              }`}
            >
              {successRate}%
            </span>
            <span className="text-[11px] text-foreground-subtle">Success rate</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-lg font-semibold text-foreground">{formatNumber(totalRecordsProcessed)}</span>
            <span className="text-[11px] text-foreground-subtle">Records synced</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-lg font-semibold text-foreground">
              {quotaUsedToday === null ? "-" : formatNumber(quotaUsedToday)}
            </span>
            <span className="text-[11px] text-foreground-subtle">Quota used today</span>
          </div>
        </FadeIn>
      )}

      <div className="flex flex-col gap-3">
        <FadeIn delay={0.15} className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
              <RadioTower className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
              Automated worker
            </h2>
            <p className="text-xs text-foreground-subtle">
              Vercel Cron fires <code className="text-foreground-muted">/api/cron/sync-live</code> every minute. Every
              firing is logged below, including no-ops — this is how to see whether it&apos;s actually running.
            </p>
          </div>
          {latestCronRun && (
            <span
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                cronWorkerIsStale ? "border-warning/30 bg-warning/10 text-warning" : "border-live/30 bg-live/10 text-live"
              }`}
            >
              {cronWorkerIsStale ? "Not checking in" : "Checking in on schedule"}
            </span>
          )}
        </FadeIn>

        {!cronRuns || cronRuns.length === 0 ? (
          <FadeIn delay={0.17} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            No cron firings recorded yet. Vercel Cron only runs against a real deployment — it never fires from local
            dev, and won&apos;t show anything here until this branch is deployed to Vercel with{" "}
            <code className="text-foreground-muted">vercel.json</code>&apos;s <code className="text-foreground-muted">crons</code> entry
            live and <code className="text-foreground-muted">CRON_SECRET</code> set.
          </FadeIn>
        ) : (
          <div className="flex flex-col gap-2">
            {cronWorkerIsStale && (
              <FadeIn delay={0.17} className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                <Clock3 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                Last check-in was {formatTimestamp(latestCronRun!.started_at)} — more than {CRON_STALE_THRESHOLD_MINUTES}{" "}
                minutes ago. The schedule fires every minute, so this either means Vercel Cron isn&apos;t invoking it
                (check the Cron Jobs tab in the Vercel dashboard and that{" "}
                <code className="text-warning">CRON_SECRET</code> matches), or this is a very fresh deploy that
                hasn&apos;t had a minute tick over yet.
              </FadeIn>
            )}
            {cronRuns.map((run, index) => {
              const style = STATUS_STYLE[run.status];
              const StatusIcon = style.icon;
              return (
                <FadeIn
                  key={run.id}
                  delay={0.18 + staggerDelay(index, 0.03)}
                  className="kivo-glass flex items-start justify-between gap-3 rounded-xl p-3"
                >
                  <div>
                    <p className="text-xs text-foreground-subtle">{formatTimestamp(run.started_at)}</p>
                    <p className="text-xs text-foreground-muted">
                      {run.error_message ??
                        (run.records_processed !== null
                          ? `${run.records_processed} record${run.records_processed === 1 ? "" : "s"} synced`
                          : null)}
                      {run.provider_quota_remaining !== null ? ` · ${run.provider_quota_remaining} quota left` : ""}
                    </p>
                  </div>
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.className}`}
                  >
                    <StatusIcon className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`} strokeWidth={2} />
                    {style.label}
                  </span>
                </FadeIn>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <FadeIn delay={0.16} className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Recent sync runs</h2>
            <p className="text-xs text-foreground-subtle">
              Admin-triggered only (manual &ldquo;Sync now&rdquo;-style actions) — the automated cron worker has its
              own section above. Prunes history older than 90 days.
            </p>
          </div>
          <PruneSyncRunsButton />
        </FadeIn>

        {!syncRuns || syncRuns.length === 0 ? (
          <FadeIn delay={0.2} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
            {providerConfigured
              ? "No syncs have run yet. Use Sync now above to pull today's fixtures."
              : "No syncs have run yet."}
          </FadeIn>
        ) : (
          <div className="flex flex-col gap-2">
            {syncRuns.map((run, index) => {
              const style = STATUS_STYLE[run.status];
              const StatusIcon = style.icon;
              return (
                <FadeIn
                  key={run.id}
                  delay={0.2 + staggerDelay(index, 0.05)}
                  className="kivo-glass flex flex-col gap-2 rounded-xl p-4 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{run.provider}</span> · {run.entity_type}
                      </p>
                      <p className="text-xs text-foreground-subtle">
                        Started {formatTimestamp(run.started_at)}
                        {run.finished_at ? ` · finished ${formatTimestamp(run.finished_at)}` : ""}
                        {run.records_processed !== null ? ` · ${run.records_processed} record${run.records_processed === 1 ? "" : "s"}` : ""}
                        {run.provider_quota_remaining !== null ? ` · ${run.provider_quota_remaining} quota left` : ""}
                      </p>
                    </div>
                    <span
                      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.className}`}
                    >
                      <StatusIcon className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`} strokeWidth={2} />
                      {style.label}
                    </span>
                  </div>
                  {run.error_message && isQuotaExhaustedMessage(run.error_message) && (
                    // RECOMMENDATIONS.md item 62: no public page calls the provider
                    // live (see the doc comment on isQuotaExhaustedMessage above), so
                    // this admin-facing summary is where "today's data is capped
                    // until tomorrow" actually needs to land.
                    <p className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                      <Clock3 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                      Today&apos;s data is capped until tomorrow. API-Football&apos;s free daily quota is used up; sync
                      will work again after it resets.
                    </p>
                  )}
                  {run.error_message && !isQuotaExhaustedMessage(run.error_message) && (
                    <p className="rounded-lg bg-critical/5 px-3 py-2 text-xs text-critical">{run.error_message}</p>
                  )}
                </FadeIn>
              );
            })}
          </div>
        )}
      </div>

      <AutomationStatusPanel />

      {/* KIVO_NEXT_GEN KN-83. Placed with the other data-integrity tools rather
          than in its own screen — it is a repair for a specific condition
          (the same real club synced twice under two providers), and burying it
          somewhere separate would make it something nobody finds when they
          need it. */}
      <TeamMergePanel teams={mergeableTeams} />

      <SyncReliabilityPanel />

      <DataQualityPanel />

      {/* KIVO_NEXT_GEN KN-107: the only forward-looking section on this page —
          everything above it reports what the pipeline already did. */}
      <SyncPlannerPanel />
    </div>
  );
}
