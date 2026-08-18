"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, X, Check, Plus } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { Skeleton } from "@/components/ui/skeleton";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { searchFantasyPlayers, type FantasyPlayerSearchResult } from "./actions";
import { POSITION_GROUPS, SQUAD_RULES, formatFantasyPrice, type PositionGroup } from "./fantasy-rules";

export function PlayerPicker({
  open,
  seasonId,
  filter,
  onFilterChange,
  onClose,
  onAdd,
  squadPlayerIds,
  squadCounts,
  remaining,
  locked,
}: {
  open: boolean;
  seasonId: string;
  filter: PositionGroup | "All";
  onFilterChange: (f: PositionGroup | "All") => void;
  onClose: () => void;
  onAdd: (p: FantasyPlayerSearchResult) => void;
  squadPlayerIds: string[];
  squadCounts: Record<PositionGroup, number>;
  remaining: number;
  locked: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FantasyPlayerSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearching] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(open, panelRef, onClose);

  // useFocusTrap focuses the first focusable element in DOM order, which is
  // the close button above the search box, not the search box itself —
  // opening the picker should put the cursor straight in the search field.
  // Declared after useFocusTrap so its rAF is scheduled second and wins
  // within the same open-triggered frame, without touching the shared hook
  // (used by other dialogs where "first focusable" is the right default).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);
  // Bumped on every search actually fired so a slow earlier response can't
  // overwrite a faster later one (RECOMMENDATIONS item 85) — a response only
  // applies if its captured sequence number is still the latest when it
  // resolves.
  const searchSeqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      const seq = ++searchSeqRef.current;
      startSearching(async () => {
        const result = await searchFantasyPlayers(seasonId, query, filter);
        if (seq !== searchSeqRef.current) return; // superseded by a newer search
        setError(result.error);
        setResults(result.players);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [open, query, filter, seasonId]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-40 flex flex-col justify-end"
        >
          {/* Non-focusable backdrop (RECOMMENDATIONS.md item 149): a real
              `<button>` here sat in tab/reading order before the dialog's
              own content. The panel's own X button (below) is the real,
              announced close control. */}
          <div aria-hidden="true" className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-picker-title"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 36 }}
            className="kivo-popover relative z-10 mx-3 mb-[calc(env(safe-area-inset-bottom)+16px)] flex max-h-[75vh] flex-col gap-3 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="player-picker-title" className="text-sm font-semibold text-foreground">Add a player</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground-subtle transition hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={2} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players…"
                className="w-full rounded-xl border border-hairline bg-surface-inset py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-accent/50"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(["All", ...POSITION_GROUPS] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => onFilterChange(group)}
                  aria-pressed={filter === group}
                  className={`inline-flex h-10 items-center justify-center rounded-full px-3.5 text-[11px] font-semibold transition ${
                    filter === group ? "kivo-gradient-victory text-on-accent" : "border border-hairline text-foreground-muted hover:bg-surface-2"
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {locked ? (
                <p className="py-8 text-center text-xs text-foreground-subtle">This gameweek is locked. Changes are closed.</p>
              ) : error ? (
                <p className="py-8 text-center text-xs text-critical">{error}</p>
              ) : searching && results.length === 0 ? (
                <div className="flex flex-col divide-y divide-hairline-soft" aria-label="Searching" role="status">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <Skeleton className="h-[26px] w-[26px] shrink-0 rounded-full" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-2.5 w-24" />
                      </div>
                      <Skeleton className="h-3 w-8 shrink-0" />
                      <Skeleton className="h-6 w-16 shrink-0 rounded-lg" />
                    </div>
                  ))}
                </div>
              ) : results.length === 0 ? (
                <p className="py-8 text-center text-xs text-foreground-subtle">
                  No players synced yet. The picker fills in once KIVO&apos;s football data sync has run.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-hairline-soft">
                  {results.map((p) => {
                    const already = squadPlayerIds.includes(p.id);
                    const group = p.positionGroup;
                    const groupFull = group !== "Other" && squadCounts[group] >= SQUAD_RULES[group];
                    const overBudget = p.price > remaining + 1e-9;
                    const disabled = already || locked || groupFull || overBudget || group === "Other";
                    return (
                      <div key={p.id} className="flex items-center gap-3 py-2.5">
                        <TeamCrest crestUrl={p.teamCrestUrl} name={p.teamName ?? ""} size={26} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">{p.name}</p>
                          <p className="truncate text-[11px] text-foreground-subtle">
                            {[p.position, p.teamName].filter(Boolean).join(" · ") || "-"}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{formatFantasyPrice(p.price)}</span>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onAdd(p)}
                          title={already ? "Already in your squad" : groupFull ? `${group} slots are full` : overBudget ? "Over budget" : undefined}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline px-2.5 py-1.5 text-[11px] font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-40"
                        >
                          {already ? (
                            <>
                              <Check className="h-3 w-3" strokeWidth={2} /> Added
                            </>
                          ) : (
                            <>
                              <Plus className="h-3 w-3" strokeWidth={2} /> Add
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
