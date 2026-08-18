import { AlertTriangle, CheckCircle2, EyeOff, ListX, TrendingUp } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { DISPLAY_LOCALE } from "@/lib/format";
import {
  SYNC_ANOMALY_WINDOW_DAYS,
  SYNC_HEALTH_WINDOW_DAYS,
  getSyncReliabilityReport,
} from "@/lib/admin/sync-reliability";
import { ReviewAnomalyButton } from "@/components/admin/review-anomaly-button";

/**
 * The four things Data Health could not previously say, on one panel
 * (KN-81, KN-86, KN-88, KN-95).
 *
 * Everything here is a count of real rows. There is deliberately no blended
 * "health score" and no trend arrow inferred from two data points: the
 * per-day table is the trend, and an admin reading two adjacent rows can see
 * whether it is getting worse without KIVO asserting that it is.
 *
 * Every section renders an honest empty state. "No failures recorded" on a
 * platform that has never run a sync means exactly that — it is not a claim
 * that syncing works.
 */
const ANOMALY_LABEL: Record<string, string> = {
  score_regression: "Score went backwards",
  status_regression: "Finished match un-finished",
  duplicate_event: "Duplicate event",
  absent_entity: "Stopped being reported",
  provider_disagreement: "Providers disagree",
};

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString(DISPLAY_LOCALE, { day: "numeric", month: "short", timeZone: "UTC" });
}

function shortTimestamp(value: string): string {
  return new Date(value).toLocaleString(DISPLAY_LOCALE, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export async function SyncReliabilityPanel() {
  const report = await getSyncReliabilityReport();

  return (
    <div className="flex flex-col gap-3">
      <FadeIn className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <TrendingUp className="h-3.5 w-3.5" strokeWidth={2} />
          Sync reliability
        </h2>
        <p className="text-xs text-foreground-subtle">
          Per-day run outcomes, the entities that actually failed, and the data conflicts the pipeline detected. Counted
          against KIVO&apos;s own tables — no provider quota spent.
        </p>
      </FadeIn>

      {/* KN-88 — the per-day rollup that makes "is this getting worse" answerable. */}
      <FadeIn delay={0.02} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            Last {SYNC_HEALTH_WINDOW_DAYS} days
          </h3>
          {report.flaggedAbsentFixtures > 0 && (
            // KN-86 — a fixture the provider stopped reporting. Flagged for a
            // human, never deleted: absence from one response is a question.
            <span className="flex items-center gap-1 rounded-full border border-warning/30 px-2 py-0.5 text-[11px] font-semibold text-warning">
              <EyeOff className="h-3 w-3" strokeWidth={2} />
              {report.flaggedAbsentFixtures} fixture{report.flaggedAbsentFixtures === 1 ? "" : "s"} no longer reported
            </span>
          )}
        </div>

        {report.health.length === 0 ? (
          <p className="rounded-xl bg-surface-1 p-4 text-center text-xs text-foreground-muted">
            No sync runs in the last {SYNC_HEALTH_WINDOW_DAYS} days.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-foreground-subtle">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Day</th>
                  <th className="pb-2 pr-3 font-medium">Provider · entity</th>
                  <th className="pb-2 pr-3 text-right font-medium">Runs</th>
                  <th className="pb-2 pr-3 text-right font-medium">OK</th>
                  <th className="pb-2 pr-3 text-right font-medium">Partial</th>
                  <th className="pb-2 pr-3 text-right font-medium">Failed</th>
                  <th className="pb-2 pr-3 text-right font-medium">Records</th>
                  <th className="pb-2 text-right font-medium">Avg secs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-soft">
                {report.health.map((row) => (
                  <tr key={`${row.day}-${row.provider}-${row.entity_type}`} className="text-foreground-muted">
                    <td className="py-2 pr-3 whitespace-nowrap text-foreground">{shortDate(row.day)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {row.provider} · {row.entity_type}
                    </td>
                    <td className="py-2 pr-3 text-right">{row.runs}</td>
                    <td className="py-2 pr-3 text-right text-live">{row.succeeded}</td>
                    <td className="py-2 pr-3 text-right">{row.partial > 0 ? row.partial : "—"}</td>
                    <td className={`py-2 pr-3 text-right ${row.failed > 0 ? "text-critical" : ""}`}>
                      {row.failed > 0 ? row.failed : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {row.records_processed}
                      {row.records_failed > 0 && <span className="text-critical"> / {row.records_failed} failed</span>}
                    </td>
                    {/* Null when no run in that bucket ever finished — shown as a
                        dash rather than 0, which would read as "instant". */}
                    <td className="py-2 text-right">{row.avg_duration_seconds ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </FadeIn>

      {/* KN-81 — the per-entity retry list. */}
      <FadeIn delay={0.04} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <ListX className="h-3.5 w-3.5" strokeWidth={2} />
            Unresolved entity failures
          </h3>
          {report.openFailures.length === 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-live">
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              None open
            </span>
          )}
        </div>
        <p className="text-[11px] text-foreground-subtle">
          One row per entity a run could not write. A row closes itself the moment a later run genuinely succeeds on
          that same provider entity — never on a timer.
        </p>
        {report.openFailures.length > 0 && (
          <ul className="flex flex-col gap-2">
            {report.openFailures.map((failure) => (
              <li key={failure.id} className="flex flex-col gap-1 rounded-xl bg-surface-1 p-3">
                <span className="text-xs text-foreground">
                  {failure.label || failure.providerEntityId}{" "}
                  <span className="text-foreground-subtle">
                    · {failure.provider}:{failure.entityType}:{failure.providerEntityId}
                  </span>
                </span>
                <span className="text-[11px] text-critical">{failure.errorMessage}</span>
                <span className="text-[11px] text-foreground-subtle">{shortTimestamp(failure.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </FadeIn>

      {/* KN-95 — the conflict surface the founding brief asked for. */}
      <FadeIn delay={0.06} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            Detected data conflicts
          </h3>
          <span className="text-[11px] text-foreground-subtle">Last {SYNC_ANOMALY_WINDOW_DAYS} days</span>
        </div>

        {report.anomalySummary.length === 0 ? (
          <p className="rounded-xl bg-surface-1 p-4 text-center text-xs text-foreground-muted">
            No conflicts detected in the last {SYNC_ANOMALY_WINDOW_DAYS} days.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {report.anomalySummary.map((row) => (
              <span
                key={`${row.anomaly_type}-${row.provider}-${row.entity_type}`}
                className="rounded-full border border-hairline px-3 py-1 text-[11px] text-foreground-muted"
              >
                <span className="font-semibold text-foreground">{row.total}</span>{" "}
                {ANOMALY_LABEL[row.anomaly_type] ?? row.anomaly_type}
                {row.unreviewed > 0 && <span className="text-warning"> · {row.unreviewed} unreviewed</span>}
              </span>
            ))}
          </div>
        )}

        {report.recentAnomalies.length > 0 && (
          <ul className="flex flex-col gap-2">
            {report.recentAnomalies.map((anomaly) => (
              <li key={anomaly.id} className="flex items-start justify-between gap-3 rounded-xl bg-surface-1 p-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-foreground">
                    {ANOMALY_LABEL[anomaly.anomalyType] ?? anomaly.anomalyType}
                  </span>
                  <span className="text-[11px] text-foreground-muted">{anomaly.detail}</span>
                  <span className="text-[11px] text-foreground-subtle">
                    {anomaly.provider} · {shortTimestamp(anomaly.createdAt)}
                  </span>
                </div>
                <ReviewAnomalyButton anomalyId={anomaly.id} />
              </li>
            ))}
          </ul>
        )}

        <p className="text-[11px] text-foreground-subtle">
          Detecting a conflict never changes the data. KIVO has one football data source, so there is nothing to
          arbitrate between — this records that two readings from that source disagreed, and leaves the decision to a
          person.
        </p>
      </FadeIn>
    </div>
  );
}
