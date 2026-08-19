"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { CompetitionLogo } from "@/components/ui/competition-logo";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";
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
 * The name filter below is a plain client-side substring match over
 * whatever page(s) are already loaded — same reasoning and trade-off as
 * `TeamsGrid`'s (audit item 5): it doesn't fetch anything itself, so a
 * league past the loaded pages still needs a "Load more" click first.
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
    return leagues.filter((league) => [league.name, league.country].some((field) => field?.toLowerCase().includes(trimmed)));
  }, [leagues, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={2} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter loaded leagues…"
          aria-label="Filter leagues"
          className="w-full rounded-xl border border-hairline bg-surface-inset py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-accent/50"
        />
      </div>

      {filteredLeagues.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">No loaded leagues match &quot;{query}&quot;.</p>
      ) : (
        <StaggeredList
          items={filteredLeagues}
          keyExtractor={(league) => league.id}
          delay={(index) => staggerDelay(index % 60, 0.03)}
          className="flex flex-col gap-2"
          renderItem={(league) => {
            const crest = <CompetitionLogo logoUrl={league.logoUrl} name={league.name} size={32} />;

            // A competition with no season synced has nowhere to link to
            // yet — `leagues/[id]` has nothing to render for it. Render a
            // non-interactive card instead of a `Link` to "#", matching the
            // honesty pattern used everywhere else on these pages (e.g.
            // "Standings not yet synced for this team").
            if (!league.hasSeason) {
              return (
                <div className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4 opacity-60">
                  {crest}
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{league.name}</span>
                    <span className="text-xs text-foreground-subtle">
                      {/* `country` was null on every competition the live
                          provider had synced, and this printed "International"
                          for all of them — a claim about the competition, not
                          a note that KIVO does not know. See
                          competitionMetaLine. */}
                      {competitionMetaLine([league.country, "No season synced yet"])}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <Link
                href={`/leagues/${league.id}`}
                className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-surface-2 kivo-focusable"
              >
                {crest}
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{league.name}</span>
                  {/* Both halves optional; an absent half prints nothing and
                      two absent halves print no line at all. */}
                  {competitionMetaLine([league.country, league.currentSeasonName]) && (
                    <span className="text-xs text-foreground-subtle">
                      {competitionMetaLine([league.country, league.currentSeasonName])}
                    </span>
                  )}
                </div>
              </Link>
            );
          }}
        />
      )}

      {hasMore && (
        <Link
          href={`/leagues?page=${page + 1}`}
          scroll={false}
          className="self-center rounded-xl border border-hairline px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          Load more
        </Link>
      )}
    </div>
  );
}
