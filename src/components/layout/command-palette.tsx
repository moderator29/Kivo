"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Search, Shield, UserRound, Trophy, CornerDownLeft } from "lucide-react";
import { searchPlatform, type SearchResult } from "@/app/(app)/search-actions";

const TYPE_ICON = { team: Shield, player: UserRound, competition: Trophy } as const;
const TYPE_LABEL = { team: "Teams", player: "Players", competition: "Competitions" } as const;
const TYPE_HREF = { team: "/teams", player: "/players", competition: "/leagues" } as const;

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    function handleGlobalKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleGlobalKeydown);
    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (query.trim().length < 2) {
        setResults([]);
        setActiveIndex(0);
        return;
      }
      startTransition(async () => {
        const next = await searchPlatform(query);
        setResults(next);
        setActiveIndex(0);
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function navigateTo(result: SearchResult) {
    router.push(`${TYPE_HREF[result.type]}/${result.id}`);
    close();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && results[activeIndex]) {
      e.preventDefault();
      navigateTo(results[activeIndex]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="kivo-glass flex w-full max-w-md items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground-muted transition hover:bg-white/5"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-foreground-subtle">Search teams, players, competitions…</span>
        <kbd className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-foreground-subtle sm:inline-block">
          ⌘K
        </kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm"
            onClick={close}
          >
            <motion.div
              initial={{ opacity: 0, y: -12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
              className="kivo-glass w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search teams, players, competitions…"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
                />
              </div>

              <div className="max-h-80 overflow-y-auto p-2">
                {query.trim().length < 2 ? (
                  <p className="px-3 py-6 text-center text-xs text-foreground-subtle">
                    Type at least 2 characters to search.
                  </p>
                ) : pending ? (
                  <p className="px-3 py-6 text-center text-xs text-foreground-subtle">Searching…</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-foreground-subtle">
                    No matches for &quot;{query}&quot;.
                  </p>
                ) : (
                  results.map((result, index) => {
                    const Icon = TYPE_ICON[result.type];
                    const active = index === activeIndex;
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => navigateTo(result)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                          active ? "bg-white/5" : ""
                        }`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5">
                          <Icon className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">{result.label}</p>
                          <p className="truncate text-[11px] text-foreground-subtle">
                            {TYPE_LABEL[result.type]}
                            {result.sublabel ? ` · ${result.sublabel}` : ""}
                          </p>
                        </div>
                        {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={2} />}
                      </button>
                    );
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
