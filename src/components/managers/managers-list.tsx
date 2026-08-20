"use client";

import { useCallback, useMemo, useState } from "react";
import { Search, UserRound } from "lucide-react";
import { ListRow, ListSurface } from "@/components/ui/list-surface";
import { EmptyState } from "@/components/ui/empty-state";
import { TeamCrest } from "@/components/ui/team-crest";
import { CappedListFooter } from "@/components/ui/capped-list-footer";
import { CAPPED_LIST_STEP, nextVisibleCount } from "@/lib/capped-list";

export type ManagerListItem = {
  id: string;
  full_name: string;
  nationality: string | null;
  current_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
};

/**
 * Client-side name filter over the full `/managers` fetch — same reasoning
 * as `VenuesList`: excluded from the global command palette's index, capped
 * at a single ~500-row fetch with no "Load more", so a plain substring
 * filter over the already-loaded page (name, nationality, current club) is
 * enough without a new server action.
 */
export function ManagersList({ managers }: { managers: ManagerListItem[] }) {
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
    if (!trimmed) return managers;
    return managers.filter((manager) =>
      [manager.full_name, manager.nationality, manager.current_team?.name, manager.current_team?.short_name].some((field) =>
        field?.toLowerCase().includes(trimmed),
      ),
    );
  }, [managers, query]);

  const shown = useMemo(() => filtered.slice(0, visible), [filtered, visible]);
  const showMore = useCallback(() => setVisible((n) => nextVisibleCount(n, filtered.length)), [filtered.length]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={2} />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search managers…"
          aria-label="Search managers"
          className="w-full rounded-xl border border-hairline bg-surface-inset py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-accent/50"
        />
      </div>

      {/* FRONTEND SWEEP: the other browse list still built as a glass card per
          row. Same fix as /players, /leagues and /venues — one surface,
          hairline-divided rows (CONTAINER_ROLES.row). */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={UserRound}
          tone="section"
          title={`No managers match “${query}”`}
          description="Try a surname, or clear the search to see everyone KIVO covers."
        />
      ) : (
        <ListSurface>
          {shown.map((manager) => (
            <ListRow
              key={manager.id}
              href={`/managers/${manager.id}`}
              leading={
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2">
                  <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
                </span>
              }
              title={manager.full_name}
              // No dash. venues-list.tsx says it best: "a '-' in the place a
              // city goes reads as a fact about the ground". A manager with no
              // recorded nationality or club gets one line, not a hyphen
              // standing in for two facts KIVO does not have.
              subtitle={[manager.nationality, manager.current_team?.name].filter(Boolean).join(" · ") || undefined}
              trailing={
                manager.current_team ? (
                  <TeamCrest crestUrl={manager.current_team.crest_url} name={manager.current_team.name} size={24} />
                ) : undefined
              }
            />
          ))}
        </ListSurface>
      )}

      <CappedListFooter visible={shown.length} total={filtered.length} onShowMore={showMore} label="managers" />
    </div>
  );
}
