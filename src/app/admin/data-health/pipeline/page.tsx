import { Workflow, Activity, Clock3, RadioTower, History, CheckCircle2, XCircle, Loader2, MinusCircle, CircleSlash } from "lucide-react";
import { DISPLAY_LOCALE, formatNumber } from "@/lib/format";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { getActiveProviderStatus } from "@/lib/football";
import { reapAbandonedSyncRuns } from "@/lib/football/sync-instrumentation";
import { FadeIn } from "@/components/ui/fade-in";
import { staggerDelay } from "@/lib/stagger";
import { PruneSyncRunsButton } from "@/components/admin/prune-sync-runs-button";
import { AutomationStatusPanel } from "@/components/admin/automation-status-panel";
import { LiveWorkerPanel } from "@/components/admin/live-worker-panel";
import { SyncReliabilityPanel } from "@/components/admin/sync-reliability-panel";
import { AdminPageHeader, AdminSection, AdminAccessNotice } from "@/components/admin/admin-chrome";
import { AdminSectionTabs } from "@/components/admin/admin-section-tabs";
import type { Database as DatabaseType } from "@/lib/supabase/types";

/**
 * Football data → Pipeline. Is it running, and is it succeeding?
 *
 * Everything on this page is retrospective and everything on it is a count of
 * real `sync_runs` rows. The ordering is the order of the question: does
 * automation exist at all (has each layer ever fired), is it firing now (the
 * once-a-minute worker's check-ins), what is it spending (the live worker's
 * ledger), what has actually run (manual history), and how reliably (per-day
 * outcomes and the conflicts detected).
 */

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

/** RECOMMENDATIONS.md item 62: getFootballDataProvider() only ever runs inside
 * admin-triggered sync actions (never a public page's render path — see
 * src/lib/football/index.ts and its only callers), so a 429 from API-Football
 * surfaces here, not on a public page. classifyHttpError() in
 * api-football-request.ts already writes an explicit "daily quota exhausted"
 * message into error_message; this just recognizes that text to show a calmer,
 * plain-language summary above the raw technical line instead of only red
 * "failed" styling. */
function isQuotaExhaustedMessage(message: string): boolean {
  return message.includes("quota exhausted");
}

/** Vercel Cron fires the live worker every minute (vercel.json). A gap
 * meaningfully longer than that between now and its last check-in means either
 * it isn't deployed/configured correctly, or (for a very fresh deploy) the
 * first minute just hasn't ticked over yet. 5x the schedule is a deliberately
 * generous margin against ordinary jitter and cold starts. */
const CRON_STALE_THRESHOLD_MINUTES = 5;

export default async function PipelinePage() {
  const profile = await getOrCreateProfile();

  if (!canManageFootballData(profile?.role)) {
    return (
      <AdminAccessNotice
        title="Pipeline"
        role={profile?.role}
        subject="Sync history"
        because="`sync_runs` is readable only by the football data, admin and super-admin roles (sync_runs_all_admin, migration 0001)."
      />
    );
  }

  const { name: activeProviderName } = getActiveProviderStatus();
  const providerConfigured = activeProviderName !== null;
  const supabase = createServerSupabaseClient();

  // Close anything a dead process left `running` before drawing these lists.
  // Syncs already reap on start, but this is the screen where a phantom
  // "Running" spinner actually misleads somebody — the live database carried
  // seven of them, hours old, on 2026-08-19. See reapAbandonedSyncRuns.
  // Service-role, not the request-scoped client: the RPC is granted to
  // service_role only (migration 0116), because closing somebody else's run
  // row is not something a signed-in session should be able to do.
  await reapAbandonedSyncRuns(createServiceRoleSupabaseClient());

  const [manualRunsResult, cronRunsResult, allRunsResult] = await Promise.all([
    // trigger_source (migration 0044) scopes this to admin-clicked runs only —
    // the automated cron worker gets its own section instead of crowding this
    // list out. Vercel Cron fires the worker once a minute once deployed, so
    // without this filter a single manual sync from days ago would already
    // have scrolled off this capped 10-row list.
    supabase
      .from("sync_runs")
      .select(
        "id, provider, entity_type, status, started_at, finished_at, records_processed, error_message, provider_quota_remaining",
      )
      .eq("trigger_source", "manual")
      .order("started_at", { ascending: false })
      .limit(10),
    // The automated worker's own recent history — every firing, including every
    // no-op decision (see src/app/api/cron/sync-live/route.ts's module doc
    // comment). Kept separate from the manual list so an admin can see "is the
    // worker actually firing, and what did it decide" without it displacing
    // manual sync history, and vice versa.
    supabase
      .from("sync_runs")
      .select("id, status, started_at, finished_at, records_processed, error_message, provider_quota_remaining")
      .eq("trigger_source", "cron")
      .order("started_at", { ascending: false })
      .limit(8),
    // The lists above are capped, so this is the only place a run-level
    // aggregate exists. The most load-bearing read on this page, and the one
    // where `?? []` was most expensive: this section exists to answer "is
    // anything actually arriving?", and its own documented failure mode is a
    // layer that was built, documented, and quietly never running. A failed
    // read reported *zero syncs, ever* — the exact signature of that failure —
    // to the one person whose job is to tell the difference.
    supabase.from("sync_runs").select("status, records_processed"),
  ]);

  const syncRuns = manualRunsResult.data;
  const cronRuns = cronRunsResult.data;
  const latestCronRun = cronRuns?.[0] ?? null;
  const cronMinutesSinceLastRun = latestCronRun
    ? (new Date().getTime() - new Date(latestCronRun.started_at).getTime()) / 60_000
    : null;
  const cronWorkerIsStale = cronMinutesSinceLastRun !== null && cronMinutesSinceLastRun > CRON_STALE_THRESHOLD_MINUTES;

  const runsOutcome = readList(allRunsResult, "admin.pipeline.syncRuns");
  const allRuns = runsOutcome.rows;
  // Null, not 0, when the read failed: the totals strip is suppressed entirely
  // rather than printing a number nobody can stand behind.
  const totalRuns = runsOutcome.failed ? null : allRuns.length;
  const successfulRuns = allRuns.filter((run) => run.status === "success").length;
  const successRate = totalRuns !== null && totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : null;
  const totalRecordsProcessed = allRuns.reduce((sum, run) => sum + (run.records_processed ?? 0), 0);

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionTabs groupId="football-data" />

      <AdminPageHeader
        icon={Workflow}
        title="Pipeline"
        lede="Whether football data is actually arriving: which automation layers have ever fired, what the once-a-minute worker is doing right now, every sync that has run, and how reliably."
        cost="Reading this page spends no provider quota. Every figure is a count of real sync_runs rows."
      />

      {runsOutcome.failed && (
        <LoadFailed
          tone="section"
          title="Sync run totals"
          description="KIVO couldn't read the sync_runs table. Reporting zero runs here would look exactly like a sync layer that has never fired, which is the one thing this page exists to tell apart — so it reports nothing instead. Try again."
        />
      )}

      {totalRuns !== null && totalRuns > 0 && (
        <FadeIn delay={0.06} className="kivo-glass grid grid-cols-3 gap-3 rounded-2xl p-5 sm:divide-x sm:divide-hairline-soft">
          <div className="flex flex-col items-center gap-1 text-center">
            <Activity className="h-4 w-4 text-accent" strokeWidth={1.75} />
            <span className="text-lg font-semibold text-foreground">{formatNumber(totalRuns)}</span>
            <span className="text-[11px] leading-tight text-foreground-subtle">Total syncs</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span
              className={`text-lg font-semibold ${
                successRate === null
                  ? "text-foreground"
                  : successRate >= 90
                    ? "text-live"
                    : successRate >= 60
                      ? "text-warning"
                      : "text-critical"
              }`}
            >
              {successRate}%
            </span>
            <span className="text-[11px] leading-tight text-foreground-subtle">Success rate</span>
          </div>
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-lg font-semibold text-foreground">{formatNumber(totalRecordsProcessed)}</span>
            <span className="text-[11px] leading-tight text-foreground-subtle">Records synced</span>
          </div>
        </FadeIn>
      )}

      <AutomationStatusPanel />

      <AdminSection
        icon={RadioTower}
        title="Once-a-minute worker"
        note={
          <>
            Vercel Cron fires <code className="text-foreground-muted">/api/cron/sync-live</code> every minute. Every
            firing is logged here, including no-ops — this is how to see whether it&apos;s actually running.
          </>
        }
        delay={0.09}
        aside={
          latestCronRun ? (
            <span
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                cronWorkerIsStale
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-live/30 bg-live/10 text-live"
              }`}
            >
              {cronWorkerIsStale ? "Not checking in" : "Checking in on schedule"}
            </span>
          ) : undefined
        }
      >
        {!cronRuns || cronRuns.length === 0 ? (
          <FadeIn delay={0.1} className="kivo-glass rounded-2xl p-6 text-sm leading-relaxed text-foreground-muted">
            No cron firings recorded yet. Vercel Cron only runs against a real deployment — it never fires from local
            dev, and won&apos;t show anything here until this branch is deployed to Vercel with{" "}
            <code className="text-foreground-muted">vercel.json</code>&apos;s{" "}
            <code className="text-foreground-muted">crons</code> entry live and{" "}
            <code className="text-foreground-muted">CRON_SECRET</code> set.
          </FadeIn>
        ) : (
          <div className="flex flex-col gap-2">
            {cronWorkerIsStale && (
              <FadeIn
                delay={0.1}
                className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning"
              >
                <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span>
                  Last check-in was {formatTimestamp(latestCronRun!.started_at)} — more than{" "}
                  {CRON_STALE_THRESHOLD_MINUTES} minutes ago. The schedule fires every minute, so this either means
                  Vercel Cron isn&apos;t invoking it (check the Cron Jobs tab in the Vercel dashboard and that{" "}
                  <code className="text-warning">CRON_SECRET</code> matches), or this is a very fresh deploy that
                  hasn&apos;t had a minute tick over yet.
                </span>
              </FadeIn>
            )}
            {cronRuns.map((run, index) => {
              const style = STATUS_STYLE[run.status];
              const StatusIcon = style.icon;
              return (
                <FadeIn
                  key={run.id}
                  delay={0.11 + staggerDelay(index, 0.03)}
                  className="kivo-glass flex items-start justify-between gap-3 rounded-xl p-3"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-foreground-subtle">{formatTimestamp(run.started_at)}</p>
                    <p className="text-xs leading-relaxed text-foreground-muted">
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
                    <StatusIcon
                      className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`}
                      strokeWidth={2}
                    />
                    {style.label}
                  </span>
                </FadeIn>
              );
            })}
          </div>
        )}
      </AdminSection>

      {/* Directly under the "is it firing" section, because this is the
          narrower question that only matters once it is: how much quota
          automation has spent, on what, and why it is idle right now. */}
      <LiveWorkerPanel />

      <AdminSection
        icon={History}
        title="Recent sync runs"
        note="Admin-triggered only (manual “Sync now”-style actions) — the automated worker has its own section above."
        delay={0.14}
        aside={<PruneSyncRunsButton />}
      >
        {!syncRuns || syncRuns.length === 0 ? (
          <FadeIn delay={0.15} className="kivo-glass rounded-2xl p-6 text-sm text-foreground-muted">
            {providerConfigured
              ? "No manual syncs have run yet. Provider → Sync now pulls today's fixtures."
              : "No manual syncs have run yet, and no provider is connected to run one."}
          </FadeIn>
        ) : (
          <div className="flex flex-col gap-2">
            {syncRuns.map((run, index) => {
              const style = STATUS_STYLE[run.status];
              const StatusIcon = style.icon;
              return (
                <FadeIn
                  key={run.id}
                  delay={0.15 + staggerDelay(index, 0.04)}
                  className="kivo-glass flex flex-col gap-2 rounded-xl p-4 transition-colors hover:bg-surface-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">
                        <span className="font-medium">{run.provider}</span> · {run.entity_type}
                      </p>
                      <p className="text-xs leading-relaxed text-foreground-subtle">
                        Started {formatTimestamp(run.started_at)}
                        {run.finished_at ? ` · finished ${formatTimestamp(run.finished_at)}` : ""}
                        {run.records_processed !== null
                          ? ` · ${run.records_processed} record${run.records_processed === 1 ? "" : "s"}`
                          : ""}
                        {run.provider_quota_remaining !== null ? ` · ${run.provider_quota_remaining} quota left` : ""}
                      </p>
                    </div>
                    <span
                      className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${style.className}`}
                    >
                      <StatusIcon
                        className={`h-3 w-3 ${run.status === "running" ? "animate-spin" : ""}`}
                        strokeWidth={2}
                      />
                      {style.label}
                    </span>
                  </div>
                  {run.error_message && isQuotaExhaustedMessage(run.error_message) && (
                    // RECOMMENDATIONS.md item 62: no public page calls the provider
                    // live (see the doc comment on isQuotaExhaustedMessage above), so
                    // this admin-facing summary is where "today's data is capped
                    // until tomorrow" actually needs to land.
                    <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
                      <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                      Today&apos;s data is capped until tomorrow. API-Football&apos;s free daily quota is used up;
                      sync will work again after it resets.
                    </p>
                  )}
                  {run.error_message && !isQuotaExhaustedMessage(run.error_message) && (
                    <p className="rounded-lg bg-critical/5 px-3 py-2 text-xs leading-relaxed text-critical">
                      {run.error_message}
                    </p>
                  )}
                </FadeIn>
              );
            })}
          </div>
        )}
      </AdminSection>

      <SyncReliabilityPanel />
    </div>
  );
}
