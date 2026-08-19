"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { AdminOnlyControl } from "@/components/admin/admin-only-control";

type InlineSyncButtonProps = {
  label: string;
  action: () => Promise<{ error: string | null; recordsProcessed?: number }>;
  /** Optional dependency-chain reminder shown under the button (RECOMMENDATIONS.md
   * item 61) — e.g. "Requires this team's fixtures synced first". Only worth
   * setting on a sync action whose prerequisite isn't already obvious from context. */
  hint?: string;
};

/** Small inline variant of the Data Health "Sync now" button, dropped into an
 * empty-state section (team squad, match lineups, league standings) so an
 * admin can pull real data right where they noticed it's missing — no need to
 * hop over to the Data Health screen. Same server actions, same guards. */
export function InlineSyncButton({ label, action, hint }: InlineSyncButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error: string | null; recordsProcessed?: number } | null>(null);

  function handleClick() {
    if (pending) return;
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      // The server action already called revalidatePath, which marks this
      // route's cache stale — but a mounted client component doesn't pick
      // that up on its own. router.refresh() re-fetches the RSC payload so
      // the newly-synced data actually appears without the user having to
      // manually reload the page.
      if (!outcome.error) router.refresh();
    });
  }

  return (
    // FRONTEND SWEEP: wrapped here rather than at each of the eight call sites,
    // so a future public-page empty state that reaches for this button cannot
    // accidentally render staff tooling that looks like product.
    <AdminOnlyControl label={label} className="items-center">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={handleClick}
        className="flex min-h-11 items-center gap-2 rounded-lg bg-accent/15 px-3 text-xs font-semibold text-accent transition hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} strokeWidth={2} />
        {pending ? "Working…" : label}
      </button>
      {hint && !result && <p className="max-w-[16rem] text-center text-[11px] text-foreground-subtle">{hint}</p>}
      {result && (
        <p className={`flex items-center gap-1 text-[11px] ${result.error ? "text-critical" : "text-live"}`} role="status">
          {result.error ? (
            <>
              <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={2} />
              {result.error}
            </>
          ) : (
            <>
              <Check className="h-3 w-3 shrink-0" strokeWidth={2} />
              Synced {result.recordsProcessed ?? 0} record{result.recordsProcessed === 1 ? "" : "s"}
            </>
          )}
        </p>
      )}
    </AdminOnlyControl>
  );
}
