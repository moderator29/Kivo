"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { StaggeredList } from "@/components/ui/staggered-list";
import { TeamCrest } from "@/components/ui/team-crest";
import { staggerDelay } from "@/lib/stagger";
import { loadMoreTeams, type TeamListItem } from "@/app/(app)/teams/actions";

/**
 * `/teams`' grid plus a "Load more" button that appends the next page via
 * `loadMoreTeams` (offset-based, not true infinite scroll — RECOMMENDATIONS
 * item 112). Existing tiles keep their React key across a load, so only the
 * newly-appended tiles play the FadeIn entrance.
 *
 * The name filter below is a plain client-side substring match over
 * whatever page(s) are already loaded — finding a team late in the alphabet
 * used to mean repeated "Load more" clicks (audit item 5). Filtering
 * doesn't fetch anything itself, so a team past the loaded pages still
 * needs a "Load more" click before it can match; that's an accepted
 * trade-off for not standing up a new server action here.
 */
export function TeamsGrid({ initialTeams, initialHasMore }: { initialTeams: TeamListItem[]; initialHasMore: boolean }) {
  const [teams, setTeams] = useState(initialTeams);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
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

  const filteredTeams = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return teams;
    return teams.filter((team) => [team.name, team.shortName, team.country].some((field) => field?.toLowerCase().includes(trimmed)));
  }, [teams, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter loaded teams…"
          aria-label="Filter teams"
          className="w-full rounded-xl border border-hairline bg-surface-inset py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-accent/50"
        />
      </div>

      {filteredTeams.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">No loaded teams match &quot;{query}&quot;.</p>
      ) : (
        <StaggeredList
          items={filteredTeams}
          keyExtractor={(team) => team.id}
          delay={(index) => staggerDelay(index % 60, 0.03)}
          className="grid grid-cols-2 gap-3 sm:grid-cols-3"
          renderItem={(team) => (
            <Link
              href={`/teams/${team.id}`}
              className="kivo-glass-sharp flex flex-col items-center gap-2 rounded-2xl p-4 text-center transition-all hover:-translate-y-0.5 hover:bg-surface-2 kivo-focusable"
            >
              <TeamCrest crestUrl={team.crestUrl} name={team.name} size={36} />
              <span className="truncate text-xs font-semibold text-foreground">{team.shortName ?? team.name}</span>
              {team.country && <span className="truncate text-[11px] text-foreground-subtle">{team.country}</span>}
            </Link>
          )}
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
          className="self-center rounded-xl border border-hairline px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
