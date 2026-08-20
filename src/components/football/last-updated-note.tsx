import { Clock } from "lucide-react";
import { timeAgo } from "@/lib/format";

/**
 * The freshness readout on public football surfaces (RECOMMENDATIONS.md item 60).
 * Takes the timestamp already resolved server-side via getLastUpdatedAt()
 * (src/lib/football/last-updated.ts) rather than fetching anything itself, so it
 * stays a plain server-renderable component.
 *
 * FRONTEND SWEEP 2026-08-19 — this component was the single most widely-rendered
 * leak of KIVO's internals into the product. It printed "Last synced 5h" on every
 * football surface and "Sync time unknown" when the timestamp was null.
 *
 * Two changes, both about what a football fan is owed:
 *
 * 1. The word. A fan does not have a sync pipeline; they have a scoreline that is
 *    either current or not. "Updated 5h ago" is the same fact in their language.
 *    Callers that passed a custom `label` were all naming an internal job
 *    ("Score and status synced") — the label prop is gone, because the only
 *    honest thing this component can say is when the page was last updated, and
 *    letting a caller re-word that is how the leak got in.
 *
 * 2. The null branch renders NOTHING. `getLastUpdatedAt` returns null for two
 *    unrelated reasons — there genuinely is no run yet, and SUPABASE_SERVICE_ROLE_KEY
 *    is missing or rotated — and the second is reachable in production, which put
 *    "Sync time unknown" above fully-current full-time scorelines. An absent
 *    freshness note is not a claim; it is the absence of one, which is exactly
 *    what KIVO actually knows in that case. Whether the page has data is something
 *    the page itself says, and it is the one that can tell.
 */
export function LastUpdatedNote({ timestamp, className = "" }: { timestamp: string | null; className?: string }) {
  if (!timestamp) return null;

  // `timeAgo` returns both bare durations ("5h", "2d") and already-complete
  // phrases ("just now", "12 Aug"). "Updated just now ago" is the kind of
  // sentence that makes a product feel unfinished, so the suffix is only
  // added to the forms that are actually a duration.
  const ago = timeAgo(timestamp);
  const reads = /^\d+[mhd]$/.test(ago) ? `Updated ${ago} ago` : `Updated ${ago}`;

  return (
    <span className={`flex items-center gap-1 text-[11px] text-foreground-subtle ${className}`}>
      <Clock className="h-3 w-3 shrink-0" strokeWidth={2} />
      {reads}
    </span>
  );
}
