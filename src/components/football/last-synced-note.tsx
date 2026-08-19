import { Clock } from "lucide-react";
import { timeAgo } from "@/lib/format";

/**
 * Small "last synced" freshness readout for public football surfaces
 * (RECOMMENDATIONS.md item 60) — takes the timestamp already resolved server-side
 * via getLastSyncedAt() (src/lib/football/last-synced.ts) rather than fetching
 * anything itself, so it stays a plain server-renderable component.
 *
 * A null timestamp used to render "Not synced yet", which is a claim about the
 * data on the page — and it was rendered directly above full-time scorelines
 * on every match page in a seeded run. `getLastSyncedAt` returns null for two
 * unrelated reasons: there genuinely is no sync_runs row, and — per its own
 * doc comment — SUPABASE_SERVICE_ROLE_KEY is missing or rotated. The second is
 * reachable in production, and would put "Not synced yet" on every public
 * football surface while they display fully synced data.
 *
 * So the component no longer asserts anything about the data. It says what it
 * actually knows: the sync time is unknown. Whether the page is empty is
 * something the page itself says, and it is the one that can tell.
 */
export function LastSyncedNote({
  timestamp,
  label = "Last synced",
  className = "",
}: {
  timestamp: string | null;
  label?: string;
  className?: string;
}) {
  return (
    <span className={`flex items-center gap-1 text-[11px] text-foreground-subtle ${className}`}>
      <Clock className="h-3 w-3 shrink-0" strokeWidth={2} />
      {timestamp ? `${label} ${timeAgo(timestamp)}` : "Sync time unknown"}
    </span>
  );
}
