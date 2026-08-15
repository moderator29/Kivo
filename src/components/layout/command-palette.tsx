"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Search, Shield, UserRound, Trophy, CornerDownLeft } from "lucide-react";
import { searchPlatform, type SearchResult } from "@/app/(app)/search-actions";

const TYPE_ICON = { team: Shield, player: UserRound, competition: Trophy } as const;
const TYPE_LABEL = { team: "Teams", player: "Players", competition: "Competitions" } as const;
const TYPE_HREF = { team: "/teams", player: "/players", competition: "/leagues" } as const;

const LISTBOX_ID = "command-palette-listbox";

function optionId(result: SearchResult): string {
  return `command-palette-option-${result.type}-${result.id}`;
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setActiveIndex(0);
    // Always return focus to the trigger: the backdrop covers the whole
    // viewport while open (nothing else is clickable behind it), so unlike a
    // lighter click-outside-anywhere dropdown, there's no competing element
    // the user could have meant to focus instead — leaving focus to fall
    // back to <body> would strand keyboard users after every close.
    triggerRef.current?.focus();
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

  // Keyboard highlight is only a visual affordance without this — arrowing
  // past the fifth result in the max-h-80 scroll container would move
  // `activeIndex` off-screen with nothing to bring it back into view.
  useEffect(() => {
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Real focus trap: aria-modal="true" is a lie without this (same pattern
  // as the mobile "more" sheet) — without it, Tab past the last result lands
  // on whatever's next in DOM order behind the backdrop, still visually
  // covered by the overlay but now receiving keyboard interaction.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("input, button") ?? []);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="kivo-glass flex w-full max-w-md items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground-muted transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
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
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Search"
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
                  role="combobox"
                  aria-expanded={results.length > 0}
                  aria-controls={LISTBOX_ID}
                  aria-autocomplete="list"
                  aria-activedescendant={results[activeIndex] ? optionId(results[activeIndex]) : undefined}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search teams, players, competitions…"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
                />
              </div>

              <div id={LISTBOX_ID} role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto p-2">
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
                        ref={active ? activeOptionRef : undefined}
                        type="button"
                        role="option"
                        id={optionId(result)}
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => navigateTo(result)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-kivo-cyan/60 ${
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
