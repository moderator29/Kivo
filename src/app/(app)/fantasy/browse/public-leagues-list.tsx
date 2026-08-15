"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Trophy, Users } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { listPublicFantasyLeagues, joinPublicFantasyLeague, type PublicFantasyLeagueListItem } from "../actions";

/**
 * `/fantasy/browse`'s search + "Load more" list. Debounces the search box
 * with the same 250ms setTimeout convention as PlayersBrowser / the fantasy
 * player picker (see `searchFantasyPlayers` callers), and appends pages via
 * `listPublicFantasyLeagues` the same offset-based way LeaguesList appends
 * via `loadMoreLeagues` — new here is a per-row Join button since, unlike
 * either of those lists, a row here is something you act on, not just a link.
 */
export function PublicLeaguesList({
  initialLeagues,
  initialHasMore,
}: {
  initialLeagues: PublicFantasyLeagueListItem[];
  initialHasMore: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [leagues, setLeagues] = useState(initialLeagues);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [listError, setListError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [searching, startSearching] = useTransition();
  const [loadingMore, startLoadingMore] = useTransition();
  const [joining, startJoining] = useTransition();
  const isFirstRun = useRef(true);

  useEffect(() => {
    // Skip the debounced fetch on mount — initialLeagues (server-rendered,
    // unfiltered) is already exactly what an empty-search fetch would return.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      startSearching(async () => {
        const result = await listPublicFantasyLeagues(query, 0);
        setListError(result.error);
        setLeagues(result.leagues);
        setHasMore(result.hasMore);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query]);

  function handleLoadMore() {
    setListError(null);
    startLoadingMore(async () => {
      const result = await listPublicFantasyLeagues(query, leagues.length);
      if (result.error) {
        setListError(result.error);
        return;
      }
      setLeagues((prev) => [...prev, ...result.leagues]);
      setHasMore(result.hasMore);
    });
  }

  function handleJoin(leagueId: string) {
    setJoinError(null);
    setJoiningId(leagueId);
    startJoining(async () => {
      const result = await joinPublicFantasyLeague(leagueId);
      if (result.error) {
        setJoinError(result.error);
        setJoiningId(null);
        return;
      }
      router.push("/fantasy");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <FadeIn delay={0.02} className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search public leagues…"
          aria-label="Search public leagues"
          className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-kivo-cyan/50"
        />
      </FadeIn>

      {joinError && <p className="text-center text-xs text-critical">{joinError}</p>}

      {listError ? (
        <p className="py-10 text-center text-sm text-critical">{listError}</p>
      ) : leagues.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">
          {searching ? "Searching…" : "No public leagues match yet. Create your own and switch it to Public."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {leagues.map((league, index) => (
            <FadeIn
              key={league.id}
              delay={Math.min((index % 20) * 0.03, 0.3)}
              className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
                <Trophy className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{league.name}</span>
                <span className="flex items-center gap-1 truncate text-xs text-foreground-subtle">
                  {league.seasonLabel}
                  <span aria-hidden="true">·</span>
                  <Users className="h-3 w-3" strokeWidth={1.75} />
                  {league.teamCount}/{league.maxTeams}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleJoin(league.id)}
                disabled={league.isFull || (joining && joiningId === league.id)}
                className="shrink-0 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-white/5 disabled:opacity-50"
              >
                {league.isFull ? "Full" : joining && joiningId === league.id ? "Joining…" : "Join"}
              </button>
            </FadeIn>
          ))}
        </div>
      )}

      {hasMore && !listError && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="self-center rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-foreground-muted transition hover:bg-white/5 disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
