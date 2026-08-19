"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Search, UserRound } from "lucide-react";
import { StaggeredList } from "@/components/ui/staggered-list";
import { TeamCrest } from "@/components/ui/team-crest";
import { staggerDelay } from "@/lib/stagger";
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

      {filtered.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">No managers match &quot;{query}&quot;.</p>
      ) : (
        <StaggeredList
          items={shown}
          keyExtractor={(manager) => manager.id}
          delay={(index) => staggerDelay(index % 60, 0.02)}
          className="flex flex-col gap-2"
          renderItem={(manager) => (
            <Link
              href={`/managers/${manager.id}`}
              className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:bg-surface-2"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2">
                <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{manager.full_name}</span>
                <span className="truncate text-xs text-foreground-subtle">
                  {[manager.nationality, manager.current_team?.name].filter(Boolean).join(" · ") || "-"}
                </span>
              </div>
              {manager.current_team && (
                <TeamCrest crestUrl={manager.current_team.crest_url} name={manager.current_team.name} size={24} />
              )}
            </Link>
          )}
        />
      )}

      <CappedListFooter visible={shown.length} total={filtered.length} onShowMore={showMore} label="managers" />
    </div>
  );
}
