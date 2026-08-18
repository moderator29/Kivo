"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X, ArrowLeftRight } from "lucide-react";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { searchPlayers } from "@/app/(app)/players/actions";

export type ComparePlayerOption = {
  id: string;
  name: string;
  teamName: string | null;
  photoUrl: string | null;
};

/**
 * One search-to-select slot. Unlike `/teams/compare`'s plain `<select>`
 * (every team fits in one dropdown), the players table can run into the
 * hundreds, so this reuses `/players`' own debounced-search pattern
 * (`searchPlayers`, 250ms) instead — the "search command palette" option
 * RECOMMENDATIONS.md item 167 names, scoped down to one field.
 */
function PlayerSlot({
  label,
  value,
  onChange,
  excludeId,
}: {
  label: string;
  value: ComparePlayerOption | null;
  onChange: (option: ComparePlayerOption | null) => void;
  excludeId: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ComparePlayerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, startSearching] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const timeout = setTimeout(() => {
      const seq = ++searchSeqRef.current;
      startSearching(async () => {
        const result = await searchPlayers(query, "All", "All");
        if (seq !== searchSeqRef.current) return;
        setResults(result.players.map((p) => ({ id: p.id, name: p.name, teamName: p.teamName, photoUrl: p.photoUrl })));
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [open, query]);

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const visibleResults = results.filter((r) => r.id !== excludeId);

  return (
    <div className="relative flex flex-col gap-1.5" ref={containerRef}>
      <label className="text-xs font-medium text-foreground-muted">{label}</label>
      {value ? (
        <div className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-2.5">
          <PlayerAvatar photoUrl={value.photoUrl} name={value.name} size={32} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-foreground">{value.name}</p>
            {value.teamName && <p className="truncate text-[11px] text-foreground-subtle">{value.teamName}</p>}
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Clear ${label}`}
            className="shrink-0 rounded-lg p-1.5 text-foreground-subtle transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Search players…"
              aria-label={label}
              className="w-full rounded-xl border border-hairline bg-surface-inset py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-accent/50"
            />
          </div>
          {open && query.trim().length >= 2 && (
            <div className="kivo-popover absolute top-full z-20 mt-1.5 max-h-64 w-full overflow-y-auto rounded-xl p-1.5">
              {searching && visibleResults.length === 0 ? (
                <div className="flex flex-col gap-1" aria-label="Searching" role="status">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-lg p-2">
                      <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-2.5 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : visibleResults.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-foreground-subtle">No players found.</p>
              ) : (
                visibleResults.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      onChange(option);
                      setQuery("");
                      setOpen(false);
                    }}
                    className="kivo-menu-item gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                  >
                    <PlayerAvatar photoUrl={option.photoUrl} name={option.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{option.name}</p>
                      {option.teamName && <p className="truncate text-[11px] text-foreground-subtle">{option.teamName}</p>}
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PlayerComparePicker({
  initialA,
  initialB,
}: {
  initialA: ComparePlayerOption | null;
  initialB: ComparePlayerOption | null;
}) {
  const router = useRouter();
  const [a, setA] = useState(initialA);
  const [b, setB] = useState(initialB);

  const canCompare = Boolean(a) && Boolean(b) && a!.id !== b!.id;

  function handleCompare() {
    if (!canCompare || !a || !b) return;
    router.push(`/players/compare?a=${a.id}&b=${b.id}`);
  }

  return (
    <div className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
        <PlayerSlot label="Player A" value={a} onChange={setA} excludeId={b?.id ?? null} />
        <div className="hidden items-center justify-center pt-7 text-foreground-subtle sm:flex" aria-hidden="true">
          <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <PlayerSlot label="Player B" value={b} onChange={setB} excludeId={a?.id ?? null} />
      </div>

      {a && b && a.id === b.id && (
        <p className="text-center text-xs text-critical" role="status" aria-live="polite">
          Choose two different players to compare.
        </p>
      )}

      <button
        type="button"
        onClick={handleCompare}
        disabled={!canCompare}
        className="kivo-gradient-prime self-center rounded-xl px-6 py-2.5 text-sm font-semibold text-on-accent kivo-raise disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        Compare
      </button>
    </div>
  );
}
