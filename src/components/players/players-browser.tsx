"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Search, UserRound } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { searchPlayers, type PlayerSearchResult } from "@/app/(app)/players/actions";
import { POSITION_GROUPS } from "@/app/(app)/fantasy/fantasy-rules";

export type PlayersClubOption = { id: string; name: string; shortName: string | null };

const FILTER_CHIPS = ["All", ...POSITION_GROUPS] as const;
type FilterChip = (typeof FILTER_CHIPS)[number];

/**
 * Client-side search/filter chrome for `/players`. Debounces the text input
 * before hitting the `searchPlayers` server action, matching the exact
 * 250ms-setTimeout debounce fantasy's player picker uses (see
 * `PlayerPicker` in `fantasy-builder.tsx`) rather than inventing a second
 * debounce convention.
 */
export function PlayersBrowser({
  initialPlayers,
  clubs,
}: {
  initialPlayers: PlayerSearchResult[];
  clubs: PlayersClubOption[];
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<FilterChip>("All");
  const [teamId, setTeamId] = useState<string>("All");
  const [players, setPlayers] = useState(initialPlayers);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearching] = useTransition();
  const isFirstRun = useRef(true);

  useEffect(() => {
    // Skip the debounced fetch on mount — `initialPlayers` (server-rendered,
    // unfiltered) is already exactly what a "All / All clubs / empty search"
    // fetch would return, so re-fetching immediately would just be a
    // redundant round-trip on first paint.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const timeout = setTimeout(() => {
      startSearching(async () => {
        const result = await searchPlayers(query, position, teamId);
        setError(result.error);
        setPlayers(result.players);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, position, teamId]);

  return (
    <div className="flex flex-col gap-4">
      <FadeIn delay={0.02} className="flex flex-col gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={1.75} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players…"
            aria-label="Search players"
            className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-kivo-cyan/50"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {FILTER_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setPosition(chip)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                position === chip
                  ? "kivo-gradient-victory text-kivo-white"
                  : "border border-white/10 text-foreground-muted hover:bg-white/5"
              }`}
            >
              {chip}
            </button>
          ))}

          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            aria-label="Filter by club"
            className="ml-auto rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-foreground-muted outline-none transition hover:bg-white/[0.08] focus:border-kivo-cyan/50"
          >
            <option value="All">All clubs</option>
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.shortName ?? club.name}
              </option>
            ))}
          </select>
        </div>
      </FadeIn>

      {error ? (
        <p className="py-10 text-center text-sm text-critical">{error}</p>
      ) : players.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">
          {searching ? "Searching…" : "No players match those filters."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {players.map((player, index) => (
            <FadeIn key={player.id} delay={Math.min(index * 0.02, 0.24)}>
              <Link
                href={`/players/${player.id}`}
                className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5">
                  <UserRound className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                </div>
                <div className="flex flex-1 flex-col overflow-hidden">
                  <span className="truncate text-sm font-medium text-foreground">{player.name}</span>
                  <span className="truncate text-xs text-foreground-subtle">
                    {[player.position, player.teamName, player.nationality].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </Link>
            </FadeIn>
          ))}
        </div>
      )}
    </div>
  );
}
