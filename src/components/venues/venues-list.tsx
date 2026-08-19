"use client";

import { useCallback, useMemo, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { ListRow, ListSurface } from "@/components/ui/list-surface";
import { EmptyState } from "@/components/ui/empty-state";
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
 *
 * One surface with hairline rows rather than a card per ground, for the same
 * reason `LeaguesList` changed: `CONTAINER_ROLES.row` in
 * src/lib/design-system.ts, and the fact that five hundred stacked glass boxes
 * is what "looks like an AI-generated dashboard" is describing.
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
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle"
          strokeWidth={1.75}
        />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search venues…"
          aria-label="Search venues"
          className="kivo-field kivo-focus h-11 w-full pl-10 pr-3 text-sm outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          tone="section"
          title="Nothing matched"
          description={`No ground here is called \u201c${query.trim()}\u201d. Try the city instead, or a shorter word.`}
        />
      ) : (
        <ListSurface>
          {shown.map((venue) => (
            <ListRow
              key={venue.id}
              href={`/venues/${venue.id}`}
              leading={
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2">
                  <MapPin className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
                </span>
              }
              title={venue.name ?? "Unnamed venue"}
              // No dash when a ground has neither a city nor a country. A "-"
              // in the place a city goes reads as a fact about the ground.
              subtitle={[venue.city, venue.country].filter(Boolean).join(", ") || undefined}
              trailing={venue.capacity ? formatNumber(venue.capacity) : undefined}
            />
          ))}
        </ListSurface>
      )}

      <CappedListFooter visible={shown.length} total={filtered.length} onShowMore={showMore} label="venues" />
    </div>
  );
}
