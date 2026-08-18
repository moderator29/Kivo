import { CheckCircle2, CircleDashed, CircleSlash } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { getCompetitionCoverage } from "@/lib/football/coverage";

/**
 * "KIVO knows / KIVO doesn't", per competition (KN-103).
 *
 * The point is the middle state. Anyone can render "no data"; what makes an
 * empty tab bearable is knowing whether waiting will help. So each row is one
 * of three things, and they are visually distinct:
 *
 *   Present     — a real count.
 *   Not synced  — the provider can supply it, nobody has asked yet.
 *   Unavailable — the active provider has no endpoint for it, so waiting will
 *                 never change this.
 *
 * This is the honest interim for the coverage registry (RECOMMENDATIONS item
 * 299): it tells people what to expect instead of hiding a tab and letting them
 * conclude the feature is broken.
 */
const STATE_STYLE = {
  present: { icon: CheckCircle2, className: "text-live", label: "Have it" },
  "not-synced": { icon: CircleDashed, className: "text-foreground-subtle", label: "Not synced yet" },
  unsupported: { icon: CircleSlash, className: "text-warning", label: "Not available" },
} as const;

export async function CompetitionCoveragePanel({
  competitionId,
  currentSeasonId,
}: {
  competitionId: string;
  currentSeasonId: string | null;
}) {
  const coverage = await getCompetitionCoverage(competitionId, currentSeasonId);

  return (
    <FadeIn className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          What KIVO has for this competition
        </h2>
        <p className="text-xs text-foreground-subtle">
          Counted from KIVO&apos;s own database right now. An empty section below says which of two things it is:
          nobody has synced it yet, or the current data source simply doesn&apos;t publish it.
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
        <p className="text-[11px] text-foreground-subtle">
          &ldquo;Not available&rdquo; means {coverage.providerLabel} has no endpoint for it — syncing more often
          won&apos;t produce it. Changing data source would.
        </p>
      ) : (
        <p className="text-[11px] text-foreground-subtle">
          No football data source is configured on this deployment yet, so nothing can be synced at all.
        </p>
      )}
    </FadeIn>
  );
}
