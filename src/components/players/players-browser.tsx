"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { StaggeredList } from "@/components/ui/staggered-list";
import { staggerDelay } from "@/lib/stagger";
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
            className="w-full rounded-xl border border-hairline bg-surface-inset py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-accent/50"
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
                  ? "kivo-gradient-victory text-on-accent"
                  : "border border-hairline text-foreground-muted hover:bg-surface-2"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`}
            >
              {chip}
            </button>
          ))}

          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            aria-label="Filter by club"
            className="ml-auto rounded-full border border-hairline bg-surface-inset px-2.5 py-1 text-[11px] font-semibold text-foreground-muted outline-none transition hover:bg-surface-2 focus:border-accent/50"
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
        <p className="py-10 text-center text-sm text-critical" role="status" aria-live="polite">
          {error}
        </p>
      ) : players.length === 0 ? (
        <p className="py-10 text-center text-sm text-foreground-muted">
          {searching ? "Searching…" : "No players match those filters."}
        </p>
      ) : (
        <StaggeredList
          items={players}
          keyExtractor={(player) => player.id}
          delay={(index) => staggerDelay(index, 0.02)}
          className="flex flex-col gap-2"
          renderItem={(player) => (
            <Link
              href={`/players/${player.id}`}
              className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:bg-surface-2 kivo-focusable"
            >
              <PlayerAvatar photoUrl={player.photoUrl} name={player.name} size={36} />
              <div className="flex flex-1 flex-col overflow-hidden">
                <span className="truncate text-sm font-medium text-foreground">{player.name}</span>
                <span className="truncate text-xs text-foreground-subtle">
                  {[player.position, player.teamName, player.nationality].filter(Boolean).join(" · ")}
                </span>
              </div>
            </Link>
          )}
        />
      )}
    </div>
  );
}
