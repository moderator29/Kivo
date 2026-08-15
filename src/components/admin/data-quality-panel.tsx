import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { getDataQualityReport } from "@/lib/admin/data-quality";

/**
 * Real data-quality signals for Admin's Data Health page (founder directive
 * 2026-08-15). Every number is a direct count against KIVO's own database —
 * nothing here spends football-provider quota, and nothing is a heuristic
 * guess. See src/lib/admin/data-quality.ts for exactly what each check
 * means and its real limitations (documented there, not glossed over here).
 */
export async function DataQualityPanel() {
  const report = await getDataQualityReport();

  const rows = [
    { label: "Teams missing a crest", value: report.teamsMissingCrest },
    { label: "Players missing a photo", value: report.playersMissingPhoto },
    { label: "Teams with no squad synced", value: report.teamsWithNoSquad },
    { label: "Orphaned provider mappings", value: report.orphanedProviderMappings },
  ];
  const totalIssues = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <FadeIn delay={0.17} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Data quality</h2>
        {totalIssues === 0 ? (
          <span className="flex items-center gap-1 text-xs font-medium text-live">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            No issues found
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-medium text-warning">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            {totalIssues} {totalIssues === 1 ? "issue" : "issues"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1 rounded-xl bg-white/[0.02] p-3">
            <span className={`text-lg font-semibold ${row.value === 0 ? "text-foreground" : "text-warning"}`}>
              {row.value}
            </span>
            <span className="text-[11px] text-foreground-subtle">{row.label}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-foreground-subtle">
        Counted directly against KIVO&apos;s own database on every page load — no provider quota spent.
      </p>
    </FadeIn>
  );
}
