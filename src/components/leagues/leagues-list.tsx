"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";
import { loadMoreLeagues, type LeagueListItem } from "@/app/(app)/leagues/actions";

/**
 * `/leagues`' list plus a "Load more" button that appends the next page via
 * `loadMoreLeagues` (offset-based, not true infinite scroll — RECOMMENDATIONS
 * item 112). Existing rows keep their React key across a load, so only the
 * newly-appended rows play the FadeIn entrance.
 */
export function LeaguesList({ initialLeagues, initialHasMore }: { initialLeagues: LeagueListItem[]; initialHasMore: boolean }) {
  const [leagues, setLeagues] = useState(initialLeagues);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <div className="flex flex-col gap-4">
      <StaggeredList
        items={leagues}
        keyExtractor={(league) => league.id}
        delay={(index) => staggerDelay(index % 60, 0.03)}
        className="flex flex-col gap-2"
        renderItem={(league) => (
          <Link
            href={league.hasSeason ? `/leagues/${league.id}` : "#"}
            className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
          >
            {league.logoUrl ? (
              <Image src={league.logoUrl} alt={league.name} width={32} height={32} className="h-8 w-8 shrink-0 object-contain" />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5">
                <Trophy className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">{league.name}</span>
              <span className="text-xs text-foreground-subtle">
                {league.country ?? "International"}
                {league.currentSeasonName ? ` · ${league.currentSeasonName}` : ""}
              </span>
            </div>
          </Link>
        )}
      />

      {error && <p className="text-center text-xs text-critical">{error}</p>}

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
