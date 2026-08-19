import { Activity, CircleAlert, CircleCheck, CircleHelp, Database, Gauge, Layers, PlugZap, TriangleAlert } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { FadeIn } from "@/components/ui/fade-in";
import { RelativeTime } from "@/components/ui/relative-time";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { AdminSection } from "@/components/admin/admin-chrome";
import { readProviderPlatformReport, type ProviderHealthReport, type ProviderHealthVerdict } from "@/lib/football/provider-health";

/**
 * The provider platform, on the Provider page.
 *
 * Answers, in this order, the questions an operator actually asks when a screen
 * in the product is empty: which provider is meant to be serving this, is it
 * answering, how fast, how much of the allowance is left, how much is on file
 * and how old it is, and what has failed.
 *
 * -----------------------------------------------------------------------------
 * TWO RULES, VISIBLE IN EVERY BRANCH BELOW
 * -----------------------------------------------------------------------------
 * **An unknown number renders as unknown.** Every figure here can be an em dash,
 * and several of them usually are. A latency nobody measured is not 0ms; a quota
 * no provider reported is not 0 requests; a provider nobody has called is not
 * healthy. The one thing this page must never do is make an untested system look
 * like a working one, because that is exactly what the previous Data Health page
 * did on 2026-08-19 while every season-scoped sync was being refused.
 *
 * **A check the viewer cannot read is not run.** Every table behind this panel
 * is RLS-on with no policies, so a viewer without the football-data role would
 * get zero rows from all of them — zero failures, zero errors, zero stale
 * entries, which reads as a clean bill of health. `readProviderPlatformReport`
 * therefore requires the capability as an argument and returns null without it,
 * and this component renders that refusal as a refusal.
 */

const VERDICT_COPY: Record<ProviderHealthVerdict, { label: string; detail: string; tone: string; Icon: typeof CircleCheck }> = {
  healthy: {
    label: "Answering",
    detail: "Recent requests are succeeding.",
    tone: "text-live",
    Icon: CircleCheck,
  },
  degraded: {
    label: "Unreliable",
    detail: "Some recent requests are failing, or the most recent one did.",
    tone: "text-warning",
    Icon: TriangleAlert,
  },
  failing: {
    label: "Failing",
    detail: "Most recent requests are failing. The panel below names the reason the provider gave.",
    tone: "text-destructive",
    Icon: CircleAlert,
  },
  unknown: {
    // The distinction the whole union exists for.
    label: "Never called",
    detail: "No request to this provider has been recorded. That is not the same as healthy — nothing has tested it.",
    tone: "text-foreground-subtle",
    Icon: CircleHelp,
  },
};

const SLOT_COPY: Record<string, string> = {
  primary: "Primary",
  secondary: "Secondary",
  legacy: "Previous",
};

/** The em dash, in one place, so "unknown" always looks the same. */
function Unknown() {
  return <span className="text-foreground-subtle">—</span>;
}

function Milliseconds({ value }: { value: number | null }) {
  if (value === null) return <Unknown />;
  return <>{formatNumber(value)}ms</>;
}

export async function ProviderPlatformPanel({ canManageFootballData }: { canManageFootballData: boolean }) {
  const supabase = createServiceRoleSupabaseClient();
  const report = await readProviderPlatformReport(supabase, { canManageFootballData });

  if (!report) {
    return (
      <AdminSection icon={PlugZap} title="Provider platform">
        <FadeIn className="kivo-glass rounded-2xl p-5">
          <p className="text-sm leading-relaxed text-foreground-muted">
            These checks read tables your role can&apos;t reach, so they weren&apos;t run. This isn&apos;t a clean
            result — it&apos;s an unread one.
          </p>
        </FadeIn>
      </AdminSection>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <AdminSection
        icon={PlugZap}
        title="Providers configured"
        note="Which credentials this deployment holds, in the order KIVO declares. This reads environment variables — it says what is configured, not which adapter a given request ended up using."
        delay={0.06}
      >
        <FadeIn delay={0.07} className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
          {report.configuration.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl bg-surface-2 px-3 py-2.5"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">
                  {provider.label}
                  <span className="ml-2 font-normal text-foreground-subtle">{SLOT_COPY[provider.slot] ?? provider.slot}</span>
                </span>
                {/* The variable name, never any part of the value. */}
                <span className="font-mono text-[11px] text-foreground-subtle">{provider.envVar}</span>
              </div>
              <span className={`text-[11px] font-semibold ${provider.credentialPresent ? "text-live" : "text-foreground-subtle"}`}>
                {provider.credentialPresent ? "Key set" : "No key"}
              </span>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed text-foreground-subtle">
            {report.configuredPrimary
              ? `${report.configuredPrimary.label} is the first configured provider in this order.${
                  report.configuredFallback ? ` ${report.configuredFallback.label} is next.` : " Nothing is configured behind it."
                }`
              : "No provider credential is set on this deployment, so nothing can be fetched at all."}
          </p>
        </FadeIn>
      </AdminSection>

      {report.health.length > 0 && (
        <AdminSection
          icon={Activity}
          title="Provider health"
          note="Measured from the last 24 hours of recorded requests. Latency figures come from timed requests only — where nothing was timed, the figure is blank rather than zero."
          delay={0.08}
        >
          <div className="flex flex-col gap-3">
            {report.health.map((health) => (
              <ProviderHealthCard key={health.provider} health={health} />
            ))}
          </div>
        </AdminSection>
      )}

      <AdminSection
        icon={Layers}
        title="What's cached"
        note="Entries in the cross-invocation response cache, by the kind of football fact they hold. 'Served' counts the times an entry answered a question without a provider request — the only figure here that says whether the cache is earning its keep."
        delay={0.1}
      >
        <FadeIn delay={0.11} className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
          {report.cache.length === 0 ? (
            <p className="text-sm text-foreground-muted">
              Nothing is cached yet. The cache fills as requests are made; an empty one on a deployment that has never
              fetched is expected.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] border-collapse text-left">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-foreground-subtle">
                      <th className="py-1.5 pr-3 font-medium">Kind</th>
                      <th className="py-1.5 pr-3 font-medium">On file</th>
                      <th className="py-1.5 pr-3 font-medium">Fresh</th>
                      <th className="py-1.5 pr-3 font-medium">Stale</th>
                      <th className="py-1.5 pr-3 font-medium">Served</th>
                      <th className="py-1.5 font-medium">Newest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.cache.map((entry) => (
                      <tr key={entry.resourceClass} className="border-t border-hairline align-top">
                        <td className="py-2 pr-3">
                          <span className="font-mono text-[11px] text-foreground">{entry.resourceClass}</span>
                          {entry.rationale && (
                            <p className="mt-0.5 max-w-md text-[11px] leading-relaxed text-foreground-subtle">
                              {entry.rationale}
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs text-foreground">{formatNumber(entry.entries)}</td>
                        <td className="py-2 pr-3 text-xs text-foreground">{formatNumber(entry.fresh)}</td>
                        <td className="py-2 pr-3 text-xs text-foreground">{formatNumber(entry.stale + entry.expired)}</td>
                        <td className="py-2 pr-3 text-xs text-foreground">{formatNumber(entry.servedCount)}</td>
                        <td className="py-2 text-xs text-foreground-muted">
                          {entry.newestFetchedAt ? <RelativeTime iso={entry.newestFetchedAt} /> : <Unknown />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-foreground-subtle">
                {formatNumber(report.cacheTotalEntries)} cached {report.cacheTotalEntries === 1 ? "entry" : "entries"} in
                total.
              </p>
            </>
          )}
        </FadeIn>
      </AdminSection>

      <AdminSection
        icon={CircleAlert}
        title="Failed syncs"
        note="Runs that ended in failure in the last seven days, newest first. A run reaped for stopping without reporting says so in its own message — that is KIVO's process ending, not the provider refusing."
        delay={0.12}
      >
        <FadeIn delay={0.13} className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
          {report.failedSyncJobs.length === 0 ? (
            <p className="text-sm text-foreground-muted">No sync run has failed in the last seven days.</p>
          ) : (
            report.failedSyncJobs.map((job) => (
              <div key={job.id} className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-xs font-semibold text-foreground">{job.entityType}</span>
                  <span className="text-[11px] text-foreground-subtle">
                    <RelativeTime iso={job.startedAt} />
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-foreground-subtle">
                  {job.message ?? "No reason was recorded for this failure."}
                </p>
              </div>
            ))
          )}
        </FadeIn>
      </AdminSection>

      {!report.complete && (
        <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-4">
          <p className="text-[11px] leading-relaxed text-warning">
            At least one of the queries behind this page failed, so what is shown above is incomplete. Treat any figure
            here as a floor rather than a total until it loads cleanly.
          </p>
        </FadeIn>
      )}
    </div>
  );
}

function ProviderHealthCard({ health }: { health: ProviderHealthReport }) {
  const verdict = VERDICT_COPY[health.verdict];
  const { Icon } = verdict;

  return (
    <FadeIn className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${verdict.tone}`} strokeWidth={1.75} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {health.provider} — <span className={verdict.tone}>{verdict.label}</span>
          </p>
          <p className="text-[11px] leading-relaxed text-foreground-subtle">{verdict.detail}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label={`Requests / ${health.windowHours}h`} value={formatNumber(health.requestCount)} />
        <Figure
          label="Failed"
          value={health.requestCount === 0 ? null : formatNumber(health.errorCount)}
          tone={health.errorCount > 0 ? "text-warning" : undefined}
        />
        <Figure
          label="Median response"
          value={health.latency.sampleCount === 0 ? null : <Milliseconds value={health.latency.medianMs} />}
        />
        <Figure
          label="Slowest (p95)"
          value={health.latency.sampleCount === 0 ? null : <Milliseconds value={health.latency.p95Ms} />}
        />
      </div>

      {health.latency.sampleCount === 0 ? (
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          No request to this provider has been timed, so there is no latency to report. Blank here means unmeasured, not
          instant.
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          From {formatNumber(health.latency.sampleCount)} timed{" "}
          {health.latency.sampleCount === 1 ? "request" : "requests"}
          {health.latency.sampleTruncated ? ", capped at the most recent 1,000" : ""}. Slowest seen:{" "}
          <Milliseconds value={health.latency.slowestMs} />.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2.5">
          <span className="text-[11px] uppercase tracking-wide text-foreground-subtle">Last success</span>
          <span className="text-xs text-foreground">
            {health.lastSuccessAt ? <RelativeTime iso={health.lastSuccessAt} /> : "Never"}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3 py-2.5">
          <span className="text-[11px] uppercase tracking-wide text-foreground-subtle">Last failure</span>
          <span className="text-xs text-foreground">
            {health.lastFailureAt ? <RelativeTime iso={health.lastFailureAt} /> : "Never"}
          </span>
          {health.lastFailureKind && (
            <span className="font-mono text-[11px] text-foreground-subtle">{health.lastFailureKind}</span>
          )}
        </div>
      </div>

      {health.lastFailureMessage && (
        <div className="rounded-xl border border-hairline px-3 py-2.5">
          <p className="text-[11px] leading-relaxed text-foreground-muted">{health.lastFailureMessage}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-foreground-subtle">
          <Gauge className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Allowance
        </span>
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          {health.quotaRemaining === null ? (
            <>
              This provider has not reported a remaining-request count on any response KIVO has seen. Some providers
              don&apos;t send one — blank here means not reported, not zero.
            </>
          ) : (
            <>
              {formatNumber(health.quotaRemaining)} requests left according to the provider&apos;s own header, read{" "}
              {health.quotaRemainingAt ? <RelativeTime iso={health.quotaRemainingAt} /> : "at an unrecorded time"}.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {health.budgets.map((bucket) => (
            <span
              key={bucket.bucket}
              className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-foreground-muted"
            >
              {bucket.bucket} {formatNumber(bucket.spentInWindow)}/{formatNumber(bucket.limit)}
            </span>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          KIVO&apos;s own ceilings over a rolling 24 hours, separate from whatever the provider allows. A rolling window
          because KIVO can&apos;t establish when a provider&apos;s own counter resets.
        </p>
      </div>

      {health.errors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-foreground-subtle">
            <Database className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            Errors by kind
          </span>
          {health.errors.map((error) => (
            <div key={error.kind} className="flex flex-col gap-0.5 rounded-xl bg-surface-2 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-mono text-[11px] font-semibold text-foreground">{error.kind}</span>
                <span className="text-[11px] text-foreground-subtle">
                  {formatNumber(error.count)}× · last <RelativeTime iso={error.lastAt} />
                </span>
              </div>
              {error.lastMessage && (
                <p className="text-[11px] leading-relaxed text-foreground-subtle">{error.lastMessage}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </FadeIn>
  );
}

function Figure({ label, value, tone }: { label: string; value: React.ReactNode | null; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-lg font-semibold ${tone ?? "text-foreground"}`}>{value ?? <Unknown />}</span>
      <span className="text-[11px] leading-tight text-foreground-subtle">{label}</span>
    </div>
  );
}
