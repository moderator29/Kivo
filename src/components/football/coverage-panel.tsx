import { CheckCircle2, CircleDashed, CircleHelp, CircleSlash } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { LocalDateTime } from "@/components/ui/relative-time";
import { getCompetitionCoverage } from "@/lib/football/coverage";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { triggerCoverageSync } from "@/app/admin/data-health/provider-data-actions";

/**
 * "KIVO knows / KIVO doesn't", per competition (KN-103, now reading the real
 * coverage registry from migration 0082).
 *
 * The point is the middle states. Anyone can render "no data"; what makes an
 * empty tab bearable is knowing whether waiting will help. So each row is one
 * of four things, and they are visually distinct:
 *
 *   Have it         — a real count.
 *   Not synced yet  — the provider says it publishes this; nobody has asked.
 *   Not available   — the provider says it does not publish this here. Waiting
 *                     will never change it.
 *   Not established — nobody has asked the provider what it publishes for this
 *                     competition, so KIVO does not know.
 *
 * The fourth state is new with the registry and it is not a cop-out: before it,
 * an unsynced registry made every gap look like "not synced yet", which is
 * itself a claim — it asserts the provider CAN supply something KIVO never
 * checked. Saying "not established" is the only honest thing to render when
 * nothing has been established, and it resolves itself the first time the
 * registry is synced.
 *
 * FRONTEND SWEEP 2026-08-19 — ADMIN ONLY, and that is the whole change here.
 *
 * Every word above is true and this panel is genuinely well built. It was also
 * rendered, in full, at the bottom of a public competition page: a four-state
 * matrix of KIVO's ingestion status, the data source's name, the phrase "syncing
 * more often won't produce it", and a note on when the coverage registry was last
 * read. A fan who came to see a league table was being handed a build report.
 *
 * The honest answer a fan is owed for an empty section is one sentence, and each
 * section now gives it ("No table for this competition yet"). The four-state
 * breakdown answers a different question — "should an operator go and fetch
 * this, and would it even work" — which only an operator can act on. So it stays,
 * unchanged and complete, for the reader it was written for.
 */
const STATE_STYLE = {
  present: { icon: CheckCircle2, className: "text-live", label: "Have it" },
  "not-synced": { icon: CircleDashed, className: "text-foreground-subtle", label: "Not synced yet" },
  unsupported: { icon: CircleSlash, className: "text-warning", label: "Not available" },
  unknown: { icon: CircleHelp, className: "text-foreground-subtle", label: "Not established" },
} as const;

export async function CompetitionCoveragePanel({
  competitionId,
  currentSeasonId,
}: {
  competitionId: string;
  currentSeasonId: string | null;
}) {
  // The gate, before the query. A fan never sees this panel, so a fan never pays
  // for the read either.
  const profile = await getOrCreateProfile();
  const canSync = profile !== null && canManageFootballData(profile.role);
  if (!canSync) return null;

  const coverage = await getCompetitionCoverage(competitionId, currentSeasonId);

  return (
    <FadeIn className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Coverage · admin only
        </h2>
        <p className="text-xs text-foreground-subtle">
          Staff view. Counted from KIVO&apos;s own database right now — a visitor sees none of this panel, only the
          one-line empty state each section carries. An empty section is one of three things: nobody has synced it
          yet, the current data source doesn&apos;t publish it for this competition, or KIVO hasn&apos;t established
          which of those it is.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-hairline-soft">
        {coverage.areas.map((area) => {
          const style = STATE_STYLE[area.state];
          const Icon = style.icon;
          return (
            <li key={area.key} className="flex items-start justify-between gap-3 py-2.5">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">{area.label}</span>
                <span className="text-[11px] text-foreground-subtle">{area.detail}</span>
              </div>
              <span className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold ${style.className}`}>
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                {style.label}
              </span>
            </li>
          );
        })}
      </ul>

      {coverage.providerLabel ? (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-foreground-subtle">
            &ldquo;Not available&rdquo; means {coverage.providerLabel} doesn&apos;t publish it for this competition —
            syncing more often won&apos;t produce it. Changing data source would.
          </p>
          {/* Where the "not available" answers come from is itself worth
              stating: a provider's own declaration and KIVO's reading of its
              endpoint list are different levels of evidence, and a reader
              deciding whether to keep waiting deserves to know which one they
              are looking at. */}
          {coverage.registrySynced ? (
            <p className="text-[11px] text-foreground-subtle">
              Based on {coverage.providerLabel}&apos;s own published coverage for this competition
              {coverage.registryRetrievedAt ? (
                <>
                  , last checked <LocalDateTime iso={coverage.registryRetrievedAt} format="dayTime" />
                </>
              ) : null}
              .
            </p>
          ) : (
            <p className="text-[11px] text-foreground-subtle">
              KIVO hasn&apos;t yet read {coverage.providerLabel}&apos;s published coverage for this competition, so
              anything marked &ldquo;not established&rdquo; is genuinely unknown rather than unavailable.
            </p>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-foreground-subtle">
          No football data source is configured on this deployment yet, so nothing can be synced at all.
        </p>
      )}

      {canSync && coverage.providerLabel && (
        <InlineSyncButton
          label={coverage.registrySynced ? "Refresh coverage" : "Read published coverage"}
          action={triggerCoverageSync.bind(null, undefined)}
          hint="One request, and it answers this for every competition at once."
        />
      )}
    </FadeIn>
  );
}
