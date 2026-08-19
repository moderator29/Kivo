"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { CompetitionLogo } from "@/components/ui/competition-logo";
import { ListRow, ListSurface } from "@/components/ui/list-surface";
import { EmptyState } from "@/components/ui/empty-state";
import { competitionMetaLine } from "@/lib/football/competition-label";
import type { LeagueListItem } from "@/app/(app)/leagues/constants";

/**
 * `/leagues`' list plus a "Load more" control (offset-based, not true infinite
 * scroll — RECOMMENDATIONS item 112).
 *
 * KN-47: the same URL-driven pagination `TeamsGrid` uses — `?page=N` in the
 * address bar rather than an offset in React state, so Back from a competition
 * page restores the list as it was, the URL is shareable, and the control works
 * without JavaScript.
 *
 * ## One surface, not sixty cards
 *
 * This list used to be a `kivo-glass-sharp rounded-2xl p-4` card per
 * competition, stacked with `gap-2`, animated in on a stagger. Sixty of those
 * is sixty borders, sixty shadows and fifty-nine gaps, and it is exactly what
 * `CONTAINER_ROLES.row` in src/lib/design-system.ts has always said not to
 * build: "stacked boxes are what makes a list look cluttered". It is now
 * `ListSurface`/`ListRow` (docs/UI_PRIMITIVES.md), which is one surface with
 * hairline-divided rows — the same list every other browse screen uses, so a
 * competition and a club look like two things in one product.
 *
 * The stagger went with it. A 30ms-per-item entrance over sixty rows is nearly
 * two seconds of movement on a page whose whole job is to be scanned, and the
 * rows below the fold animate where nobody is looking.
 *
 * The name filter is a plain client-side substring match over whatever page(s)
 * are already loaded — same reasoning and trade-off as `TeamsGrid`'s (audit
 * item 5): it doesn't fetch anything itself, so a competition past the loaded
 * pages still needs a "Load more" click first.
 */
export function LeaguesList({
  leagues,
  hasMore,
  page,
}: {
  leagues: LeagueListItem[];
  hasMore: boolean;
  /** Pages currently loaded, straight from the URL — see resolveListPage. */
  page: number;
}) {
  const [query, setQuery] = useState("");

  const filteredLeagues = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return leagues;
    return leagues.filter((league) =>
      [league.name, league.country].some((field) => field?.toLowerCase().includes(trimmed)),
    );
  }, [leagues, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-subtle"
          strokeWidth={1.75}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter competitions…"
          aria-label="Filter competitions"
          // 44px tall: this is the control most people on a phone will use
          // first, and a 38px field is not a comfortable target.
          className="kivo-field kivo-focus h-11 w-full pl-10 pr-3 text-sm outline-none"
        />
      </div>

      {filteredLeagues.length === 0 ? (
        <EmptyState
          icon={Search}
          tone="section"
          title="Nothing matched"
          description={`No competition here is called “${query.trim()}”. Try a shorter word, or load more below.`}
        />
      ) : (
        <ListSurface>
          {filteredLeagues.map((league) => {
            const crest = <CompetitionLogo logoUrl={league.logoUrl} name={league.name} size={28} />;

            // A competition with no season on record has nowhere to link to —
            // `leagues/[id]` has nothing to render for it — so the row is not a
            // link and says why in the one line it has. A row that navigates
            // to an empty page is worse than a row that does not navigate.
            if (!league.hasSeason) {
              return (
                <ListRow
                  key={league.id}
                  leading={crest}
                  title={league.name}
                  subtitle={competitionMetaLine([league.country, "No season yet"])}
                />
              );
            }

            return (
              <ListRow
                key={league.id}
                href={`/leagues/${league.id}`}
                leading={crest}
                title={league.name}
                // Both halves optional; an absent half prints nothing and two
                // absent halves print no line at all. Never "International",
                // never "Unknown" — see competitionMetaLine.
                subtitle={competitionMetaLine([league.country, league.currentSeasonName])}
                chevron
              />
            );
          })}
        </ListSurface>
      )}

      {hasMore && (
        <Link
          href={`/leagues?page=${page + 1}`}
          scroll={false}
          className="kivo-focus self-center rounded-xl border border-hairline px-4 py-3 text-xs font-semibold text-foreground-muted transition-colors hover:bg-surface-2"
        >
          Load more
        </Link>
      )}
    </div>
  );
}
