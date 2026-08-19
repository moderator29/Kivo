"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Search, X, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { searchClubs, setRivalClub, type ClubOption } from "@/app/(app)/settings/club-actions";
import { TeamCrest } from "@/components/ui/team-crest";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The rival picker: exactly one selection, never a multi-select capped at one,
 * because `profiles.rival_team_id` is a single nullable FK and a second rival
 * is not expressible rather than merely refused. The club you *support* is
 * edited at /profile/club — see setRivalClub for why this page does not offer
 * a second editor for it.
 */
export function RivalClubPicker({
  initialClub,
  emptyPrompt,
}: {
  initialClub: ClubOption | null;
  emptyPrompt: string;
}) {
  const [club, setClubState] = useState<ClubOption | null>(initialClub);
  const [picking, setPicking] = useState(initialClub === null);
  const [query, setQuery] = useState("");
  const [clubs, setClubs] = useState<ClubOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!picking) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const seq = ++seqRef.current;
      searchClubs(query)
        .then((result) => {
          if (seq !== seqRef.current) return;
          setClubs(result.clubs);
          setError(result.error);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setClubs([]);
          setError("Couldn't search clubs. Try again.");
        });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, picking]);

  useEffect(() => {
    if (!justSaved) return;
    const id = setTimeout(() => setJustSaved(false), 2200);
    return () => clearTimeout(id);
  }, [justSaved]);

  function choose(next: ClubOption | null) {
    setError(null);
    startSaving(async () => {
      const result = await setRivalClub(next?.id ?? null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setClubState(next);
      setPicking(next === null);
      setQuery("");
      setJustSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {club && (
        <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-1 p-3">
          <TeamCrest crestUrl={club.crestUrl} name={club.name} size={36} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{club.name}</span>
            {club.country && <span className="block truncate text-xs text-foreground-subtle">{club.country}</span>}
          </span>
          <AnimatePresence>
            {justSaved && (
              <motion.span
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex shrink-0 items-center gap-1 text-xs font-medium text-accent"
                role="status"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                Saved
              </motion.span>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            disabled={saving}
            className="kivo-focus shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
          >
            {picking ? "Cancel" : "Change"}
          </button>
        </div>
      )}

      {picking && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-xl border border-hairline bg-surface-1 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={emptyPrompt}
              aria-label={emptyPrompt}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear"
                className="kivo-focus shrink-0 rounded-full p-1 text-foreground-subtle hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>

          <div className="flex max-h-72 flex-col overflow-y-auto rounded-xl border border-hairline">
            {clubs === null ? (
              <div className="flex flex-col gap-2 p-3" role="status" aria-label="Loading clubs">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                    <Skeleton className="h-3 w-36" />
                  </div>
                ))}
              </div>
            ) : clubs.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-foreground-subtle">
                {query.trim().length >= 2
                  ? `No club matching "${query.trim()}".`
                  : "No clubs to choose from yet."}
              </p>
            ) : (
              clubs.map((option, index) => {
                const selected = club?.id === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={saving}
                    onClick={() => choose(option)}
                    aria-pressed={selected}
                    className={cn(
                      "kivo-focus flex min-h-14 items-center gap-3 px-3 text-left transition-colors hover:bg-surface-2 focus-visible:ring-inset disabled:opacity-60",
                      index > 0 && "border-t border-hairline-soft",
                    )}
                  >
                    <TeamCrest crestUrl={option.crestUrl} name={option.name} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{option.name}</span>
                      {option.country && (
                        <span className="block truncate text-xs text-foreground-subtle">{option.country}</span>
                      )}
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {club && !picking && (
        <button
          type="button"
          onClick={() => choose(null)}
          disabled={saving}
          className="kivo-focus w-fit rounded-lg text-xs font-medium text-foreground-subtle transition-colors hover:text-critical disabled:opacity-50"
        >
          Remove
        </button>
      )}

      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
