"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { Shield } from "lucide-react";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";
import { loadMoreTeams, type TeamListItem } from "@/app/(app)/teams/actions";

/**
 * `/teams`' grid plus a "Load more" button that appends the next page via
 * `loadMoreTeams` (offset-based, not true infinite scroll — RECOMMENDATIONS
 * item 112). Existing tiles keep their React key across a load, so only the
 * newly-appended tiles play the FadeIn entrance.
 */
export function TeamsGrid({ initialTeams, initialHasMore }: { initialTeams: TeamListItem[]; initialHasMore: boolean }) {
  const [teams, setTeams] = useState(initialTeams);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();

  function handleLoadMore() {
    setError(null);
    startLoading(async () => {
      const result = await loadMoreTeams(teams.length);
      if (result.error) {
        setError(result.error);
        return;
      }
      setTeams((prev) => [...prev, ...result.teams]);
      setHasMore(result.hasMore);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <StaggeredList
        items={teams}
        keyExtractor={(team) => team.id}
        delay={(index) => staggerDelay(index % 60, 0.03)}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3"
        renderItem={(team) => (
          <Link
            href={`/teams/${team.id}`}
            className="kivo-glass-sharp flex flex-col items-center gap-2 rounded-2xl p-4 text-center transition-all hover:-translate-y-0.5 hover:bg-surface-2 kivo-focusable"
          >
            {team.crestUrl ? (
              <Image src={team.crestUrl} alt={team.name} width={36} height={36} className="h-9 w-9 object-contain" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2">
                <Shield className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              </div>
            )}
            <span className="truncate text-xs font-semibold text-foreground">{team.shortName ?? team.name}</span>
            {team.country && <span className="truncate text-[11px] text-foreground-subtle">{team.country}</span>}
          </Link>
        )}
      />

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
          className="self-center rounded-xl border border-hairline px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
