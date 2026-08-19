"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, AlertTriangle } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { previewTeamMerge, confirmTeamMerge, type TeamMergeReport } from "@/app/admin/data-health/merge-actions";

/**
 * KIVO_NEXT_GEN KN-83. Merging two clubs that are the same real club.
 *
 * The interaction is the safety feature. There is no one-click merge: the only
 * button available first is Preview, and Confirm does not exist until a
 * preview has come back clean. The database function defaults to a dry run for
 * the same reason.
 *
 * The panel is deliberately blunt about what it is. This deletes a club row and
 * rewrites every row pointing at it, and `entity_merges` keeps the removed row
 * and the per-table counts — but the repointed foreign keys afterwards are
 * indistinguishable from rows that always belonged to the survivor. It cannot
 * be undone by clicking something, and the copy says so before, not after.
 */
export function TeamMergePanel({ teams }: { teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const [survivorId, setSurvivorId] = useState("");
  const [mergedId, setMergedId] = useState("");
  const [report, setReport] = useState<TeamMergeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canPreview = survivorId !== "" && mergedId !== "" && survivorId !== mergedId;
  const canConfirm = report !== null && report.ok && report.dryRun && report.blockers.length === 0;

  function preview() {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const result = await previewTeamMerge(survivorId, mergedId);
      if (result.error) setError(result.error);
      setReport(result.report);
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmTeamMerge(survivorId, mergedId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(
        `Merged ${result.report?.mergedName ?? "that club"} into ${result.report?.survivorName ?? "the survivor"}.`,
      );
      setReport(null);
      setSurvivorId("");
      setMergedId("");
      router.refresh();
    });
  }

  if (teams.length < 2) {
    return (
      <FadeIn className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <GitMerge className="h-3.5 w-3.5" strokeWidth={2} />
          Merge duplicate clubs
        </h2>
        <p className="text-xs text-foreground-subtle">
          Nothing to merge — this needs at least two synced clubs. Duplicates appear when the same real club is synced
          under two different data providers, each with its own id.
        </p>
      </FadeIn>
    );
  }

  return (
    <FadeIn className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <GitMerge className="h-3.5 w-3.5" strokeWidth={2} />
          Merge duplicate clubs
        </h2>
        <p className="text-xs text-foreground-subtle">
          When the same real club exists twice — usually because two data providers each synced it under their own id —
          this repoints every fixture, table row, squad, follow and provider mapping onto one of them and removes the
          other.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-foreground-subtle">Keep this club</span>
          <select
            value={survivorId}
            onChange={(event) => {
              setSurvivorId(event.target.value);
              setReport(null);
            }}
            className="kivo-glass-sharp h-11 rounded-xl px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <option value="">Choose…</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-foreground-subtle">Merge this one into it</span>
          <select
            value={mergedId}
            onChange={(event) => {
              setMergedId(event.target.value);
              setReport(null);
            }}
            className="kivo-glass-sharp h-11 rounded-xl px-3 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <option value="">Choose…</option>
            {teams
              .filter((team) => team.id !== survivorId)
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canPreview || pending}
          onClick={preview}
          className="kivo-glass-sharp inline-flex min-h-11 items-center rounded-xl px-4 text-xs font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {pending ? "Checking…" : "Preview merge"}
        </button>
        {canConfirm && (
          <button
            type="button"
            disabled={pending}
            onClick={confirm}
            className="inline-flex min-h-11 items-center rounded-xl border border-critical/40 bg-critical/10 px-4 text-xs font-semibold text-critical transition-transform active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-critical/60"
          >
            Merge for real — this can&apos;t be undone
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
      {done && (
        <p className="text-xs text-live" role="status" aria-live="polite">
          {done}
        </p>
      )}

      {report && report.blockers.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-warning/25 bg-warning/5 p-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            This merge is blocked
          </span>
          {report.blockers.map((blocker) => (
            <p key={blocker} className="text-[11px] text-foreground-muted">
              {blocker}
            </p>
          ))}
        </div>
      )}

      {report && report.ok && report.blockers.length === 0 && (
        <div className="flex flex-col gap-2 rounded-xl bg-surface-1 p-3">
          <span className="text-xs text-foreground">
            {report.mergedName} would be merged into {report.survivorName}.
          </span>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
            {Object.entries(report.counts)
              // Only what actually moves. A wall of zeroes buries the two
              // numbers an admin is really deciding on.
              .filter(([, value]) => value > 0)
              .map(([key, value]) => (
                <li key={key} className="text-[11px] text-foreground-subtle">
                  <span className="font-semibold text-foreground-muted">{value}</span>{" "}
                  {key.replace(/_/g, " ")}
                </li>
              ))}
          </ul>
          {Object.values(report.counts).every((value) => value === 0) && (
            <p className="text-[11px] text-foreground-subtle">
              Nothing points at the club being merged — this only removes an empty duplicate.
            </p>
          )}
        </div>
      )}
    </FadeIn>
  );
}
