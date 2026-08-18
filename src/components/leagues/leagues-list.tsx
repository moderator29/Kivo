"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Search, Trophy } from "lucide-react";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";
import { loadMoreLeagues, type LeagueListItem } from "@/app/(app)/leagues/actions";

/**
 * `/leagues`' list plus a "Load more" button that appends the next page via
 * `loadMoreLeagues` (offset-based, not true infinite scroll — RECOMMENDATIONS
 * item 112). Existing rows keep their React key across a load, so only the
 * newly-appended rows play the FadeIn entrance.
 *
 * The name filter below is a plain client-side substring match over
 * whatever page(s) are already loaded — same reasoning and trade-off as
 * `TeamsGrid`'s (audit item 5): it doesn't fetch anything itself, so a
 * league past the loaded pages still needs a "Load more" click first.
 */
export function LeaguesList({ initialLeagues, initialHasMore }: { initialLeagues: LeagueListItem[]; initialHasMore: boolean }) {
  const [leagues, setLeagues] = useState(initialLeagues);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, startLoading] = useTransition();

  function handleLoadMore() {
    setError(null);
    startLoading(async () => {
      const result = await loadMoreLeagues(leagues.length);
      if (result.error) {
        setError(result.error);
        return;
      }
      setLeagues((prev) => [...prev, ...result.leagues]);
      setHasMore(result.hasMore);
    });
  }

  const filteredLeagues = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return leagues;
    return leagues.filter((league) => [league.name, league.country].some((field) => field?.toLowerCase().includes(trimmed)));
  }, [leagues, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter loaded leagues…"
          aria-label="Filter leagues"
          className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-kivo-cyan/50"
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
            const crest = league.logoUrl ? (
              <Image src={league.logoUrl} alt={league.name} width={32} height={32} className="h-8 w-8 shrink-0 object-contain" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5">
                <Trophy className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              </div>
            );

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
                      {league.country ?? "International"} · No season synced yet
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <Link
                href={`/leagues/${league.id}`}
                className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
              >
                {crest}
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{league.name}</span>
                  <span className="text-xs text-foreground-subtle">
                    {league.country ?? "International"}
                    {league.currentSeasonName ? ` · ${league.currentSeasonName}` : ""}
                  </span>
                </div>
              </Link>
            );
          }}
        />
      )}

      {error && (
        <p className="text-center text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}

      {hasMore && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loading}
          className="self-center rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-white/5 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
