import { Clock } from "lucide-react";
import { timeAgo } from "@/lib/format";

/**
 * Small "last synced" freshness readout for public football surfaces
 * (RECOMMENDATIONS.md item 60) — takes the timestamp already resolved server-side
 * via getLastSyncedAt() (src/lib/football/last-synced.ts) rather than fetching
 * anything itself, so it stays a plain server-renderable component.
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
      {timestamp ? `${label} ${timeAgo(timestamp)}` : "Not synced yet"}
    </span>
  );
}
