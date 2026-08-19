"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";
import { CappedListFooter } from "@/components/ui/capped-list-footer";
import { CAPPED_LIST_STEP, nextVisibleCount } from "@/lib/capped-list";

export type VenueListItem = {
  id: string;
  name: string | null;
  city: string | null;
  country: string | null;
  capacity: number | null;
};

/**
 * Client-side name filter over the full `/venues` fetch. Venues aren't
 * covered by the global command palette (⌘K only indexes team/player/
 * competition), and at the ~500-row single-fetch cap this table syncs to, a
 * plain substring filter over the already-loaded page is enough — no new
 * server action, offset pagination, or debounce needed, unlike `/players`'
 * server-side search over a much larger table.
 */
export function VenuesList({ venues }: { venues: VenueListItem[] }) {
  const [query, setQuery] = useState("");
  // Everything stays in memory so the filter still searches the whole set —
  // it is the DOM that is expensive, not the array. See src/lib/capped-list.ts
  // for the measurements that decided this.
  const [visible, setVisible] = useState(CAPPED_LIST_STEP);

  const onQueryChange = useCallback((value: string) => {
    setQuery(value);
    // A new search starts from the top of its own results, never mid-way
    // through the previous one's window.
    setVisible(CAPPED_LIST_STEP);
  }, []);

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return venues;
    return venues.filter((venue) => [venue.name, venue.city, venue.country].some((field) => field?.toLowerCase().includes(trimmed)));
  }, [venues, query]);

  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const showMore = useCallback(() => setVisible((n) => nextVisibleCount(n, filtered.length)), [filtered.length]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={2} />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search venues…"
          aria-label="Search venues"
          className="w-full rounded-xl border border-hairline bg-surface-inset py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-accent/50"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">No venues match &quot;{query}&quot;.</p>
      ) : (
        <StaggeredList
          items={shown}
          keyExtractor={(venue) => venue.id}
          delay={(index) => staggerDelay(index % 60, 0.02)}
          className="flex flex-col gap-2"
          renderItem={(venue) => (
            <Link
              href={`/venues/${venue.id}`}
              className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
                <MapPin className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{venue.name ?? "Unnamed venue"}</span>
                <span className="truncate text-xs text-foreground-subtle">
                  {[venue.city, venue.country].filter(Boolean).join(", ") || "-"}
                </span>
              </div>
              {venue.capacity && (
                <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground-subtle">
                  {formatNumber(venue.capacity)}
                </span>
              )}
            </Link>
          )}
        />
      )}

      <CappedListFooter visible={shown.length} total={filtered.length} onShowMore={showMore} label="venues" />
    </div>
  );
}
