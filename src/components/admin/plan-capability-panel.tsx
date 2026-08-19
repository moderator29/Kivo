import { CalendarRange, CheckCircle2, CircleHelp, CreditCard, XCircle } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { buildPlanCapabilityReport, type CapabilityStatus } from "@/lib/football/plan-capability";
import { describeTargetSeason, TARGET_SEASON_ENV } from "@/lib/football/target-season";
import { TargetSeasonControl } from "@/components/admin/target-season-control";
import { LocalDateTime } from "@/components/ui/relative-time";

/**
 * Which plan, which seasons, which endpoints — in one place.
 *
 * ## What this panel is for
 *
 * On 2026-08-19 the live database held 705 teams and 354 fixtures and nothing
 * else: no players, no managers, no standings, no lineups, no transfers, no
 * club lists, no coverage registry. Every screen in KIVO drew that as an empty
 * state. The actual reason was one sentence the provider had been repeating all
 * day, visible only to somebody willing to read a `sync_runs.error_message`
 * column:
 *
 *   "Free plans do not have access to this season, try from 2022 to 2024."
 *
 * A failed read drawn as an empty state is this project's recurring bug, and
 * this panel is the direct answer to it. Everything below is either something
 * the provider said (quoted and attributed) or something KIVO knows about its
 * own request paths. Nothing is inferred about a subscription KIVO cannot see.
 *
 * ## Why "unknown" appears at all
 *
 * A season-scoped endpoint that has never been refused, on an account whose
 * season window the provider has never stated, is genuinely unknown. Rendering
 * it green would promise something; rendering it red would blame a plan on no
 * evidence. It says unknown, which is what KIVO actually has.
 */

const STATUS_STYLE: Record<CapabilityStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  available: { icon: CheckCircle2, className: "text-live", label: "Available" },
  blocked: { icon: XCircle, className: "text-critical", label: "Blocked" },
  unknown: { icon: CircleHelp, className: "text-foreground-subtle", label: "Unknown" },
};

export async function PlanCapabilityPanel() {
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();
  if (!providerName) return null;

  const supabase = createServiceRoleSupabaseClient();
  const report = await buildPlanCapabilityReport(supabase);

  const { targetSeason, plan, supportedSeasonsPerLastRefusal: window } = report;
  // Offered only when the provider itself named a range. A suggestion KIVO
  // invented would send an operator to a season that is also refused.
  const suggestedYear = window ? Math.min(window.to, Math.max(window.from, targetSeason.calendarSeasonYear)) : null;

  const blocked = report.capabilities.filter((capability) => capability.status === "blocked");

  return (
    <FadeIn delay={0.107} className="kivo-glass flex flex-col gap-5 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CreditCard className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Plan and season coverage
        </h2>
        <p className="text-xs text-foreground-muted">
          What {providerLabel ?? providerName} will and will not serve this account, and the one setting that changes
          it. Reading this page spends one provider request (the account-status call); nothing else here costs
          anything.
        </p>
      </div>

      {/* ---- What the provider says about the account ---- */}
      <div className="flex flex-col gap-2 rounded-xl border border-hairline-soft bg-surface-1 p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          What the provider says about this account
        </h3>
        {plan ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-subtle">Plan</dt>
              <dd className="font-semibold text-foreground">{plan.planName ?? "Not stated"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-subtle">Subscription</dt>
              <dd className="font-semibold text-foreground">
                {plan.active === null ? "Not stated" : plan.active ? "Active" : "Inactive"}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-subtle">Requests today</dt>
              <dd className="font-semibold text-foreground">
                {plan.requestsToday === null && plan.requestsPerDay === null
                  ? "Not stated"
                  : `${plan.requestsToday ?? "?"} / ${plan.requestsPerDay ?? "?"}`}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-foreground-subtle">Account</dt>
              <dd className="font-semibold text-foreground">{plan.accountLabel ?? "Not stated"}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-foreground-muted">
            {report.planUnavailableReason ??
              "KIVO could not read this account's plan. That is a gap in what is knowable, not a statement about the plan."}
          </p>
        )}
      </div>

      {/* ---- The target season ---- */}
      <div className="flex flex-col gap-3 rounded-xl border border-hairline-soft bg-surface-1 p-4">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          <CalendarRange className="h-3.5 w-3.5" strokeWidth={2} />
          Target season
        </h3>
        <p className={`text-xs ${targetSeason.isOverride ? "font-medium text-warning" : "text-foreground-muted"}`}>
          {describeTargetSeason(targetSeason)}
        </p>
        {targetSeason.setAt && (
          <p className="text-[11px] text-foreground-subtle">
            Set <LocalDateTime iso={targetSeason.setAt} format="full" />.
          </p>
        )}
        {report.targetSeasonIsRefused && window && (
          <p className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-xs font-medium text-critical">
            This plan does not cover season {targetSeason.seasonYear}. The provider said it can serve {window.from} to{" "}
            {window.to}. Until the target season is inside that range, every season-scoped sync below will keep being
            refused — and each refusal looks like an empty table, not an error.
          </p>
        )}
        <TargetSeasonControl
          currentSeasonYear={targetSeason.seasonYear}
          calendarSeasonYear={targetSeason.calendarSeasonYear}
          isOverride={targetSeason.isOverride}
          suggestedYear={suggestedYear}
        />
        <p className="text-[11px] text-foreground-subtle">
          Changing this changes which season the NEXT sync asks for. It moves nothing already in the database, and it
          never changes what a stored fixture or standing means. The environment variable {TARGET_SEASON_ENV} does the
          same thing without a database row, and a row here wins over it.
        </p>
      </div>

      {/* ---- Endpoint by endpoint ---- */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Endpoint by endpoint
          {blocked.length > 0 && (
            <span className="ml-2 font-medium normal-case tracking-normal text-critical">
              {blocked.length} blocked
            </span>
          )}
        </h3>
        {report.capabilities.length === 0 ? (
          <p className="text-xs text-foreground-muted">
            KIVO holds no endpoint map for {providerLabel ?? providerName}. The map is API-Football&apos;s request
            surface, read off KIVO&apos;s own adapter; presenting a guessed version of another provider&apos;s surface
            would be worse than showing none. See docs/PROVIDER_ABSTRACTION.md for that provider&apos;s capability
            matrix.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-hairline-soft">
            {report.capabilities.map((capability) => {
              const style = STATUS_STYLE[capability.status];
              const Icon = style.icon;
              return (
                <li key={capability.endpoint} className="flex items-start gap-3 py-2.5">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.className}`} strokeWidth={2} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-xs font-semibold text-foreground">{capability.label}</span>
                      <code className="font-mono text-[11px] text-foreground-subtle">{capability.endpoint}</code>
                      {capability.seasonScoped && (
                        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-foreground-subtle">
                          season-scoped
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-foreground-muted">{capability.reason}</p>
                    <p className="text-[11px] text-foreground-subtle">Fills: {capability.fills}</p>
                  </div>
                  <span className={`shrink-0 text-[11px] font-semibold ${style.className}`}>{style.label}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ---- The provider's own words ---- */}
      {report.refusals.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-hairline-soft bg-surface-1 p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
            Refusals KIVO has actually been given
          </h3>
          <p className="text-[11px] text-foreground-subtle">
            Quoted from `sync_runs`, not re-requested — asking the provider to refuse KIVO again in order to display
            the refusal would spend quota to learn something already written down.
          </p>
          <ul className="flex flex-col gap-2">
            {report.refusals.map((refusal) => (
              <li key={`${refusal.entityType}-${refusal.at}`} className="flex flex-col gap-0.5">
                <span className="text-[11px] font-semibold text-foreground-muted">
                  {refusal.entityType} — <LocalDateTime iso={refusal.at} format="full" />
                </span>
                <span className="text-[11px] text-foreground-subtle">{refusal.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </FadeIn>
  );
}
