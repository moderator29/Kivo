"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Search, Shield, UserRound, Trophy, CalendarDays, CornerDownLeft, Clock, Flame, X } from "lucide-react";
import { searchPlatform, getPopularTeams, type SearchResult, type PopularTeam } from "@/app/(app)/search-actions";
import { TeamCrest } from "@/components/ui/team-crest";
import { Skeleton } from "@/components/ui/skeleton";

const TYPE_ICON = { team: Shield, player: UserRound, competition: Trophy } as const;
const TYPE_LABEL = { team: "Teams", player: "Players", competition: "Competitions" } as const;
const TYPE_HREF = { team: "/teams", player: "/players", competition: "/leagues" } as const;

const LISTBOX_ID = "command-palette-listbox";

// Item 128: an empty query used to be a dead end ("Type at least 2
// characters to search") with nothing to click — these give a new user
// (empty database or not) somewhere to go immediately instead of a second
// dead end once they do type ("No matches"). Reuses the same three entity
// types searchPlatform already covers plus Matches, the one other browse
// surface a command palette user would reasonably reach for.
const QUICK_LINKS = [
  { label: "Teams", href: "/teams", icon: Shield },
  { label: "Players", href: "/players", icon: UserRound },
  { label: "Competitions", href: "/leagues", icon: Trophy },
  { label: "Matches", href: "/matches", icon: CalendarDays },
] as const;

// Item 128: recent searches. Real queries this browser actually searched
// for, not user data — localStorage is the right home (no new schema, and
// nothing here needs to sync across devices or survive a cleared browser,
// same standing this codebase already applies to e.g. onboarding dismissal
// flags). Capped small and deduped case-insensitively so retyping the same
// team name doesn't pad the list with near-duplicates.
const RECENT_SEARCHES_KEY = "kivo:recent-searches";
const MAX_RECENT_SEARCHES = 5;

function loadRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((q): q is string => typeof q === "string" && q.length > 0).slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/** Records a real, completed search — called when the user actually
 * navigates to a result, not on every debounced keystroke, so the list holds
 * genuine finished searches rather than every half-typed prefix. */
function saveRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  if (typeof window === "undefined" || trimmed.length < 2) return loadRecentSearches();
  try {
    const deduped = loadRecentSearches().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
    const next = [trimmed, ...deduped].slice(0, MAX_RECENT_SEARCHES);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    return next;
  } catch {
    // Private browsing / storage quota — recent searches is a UX nicety,
    // never worth failing the actual navigation over.
    return loadRecentSearches();
  }
}

function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Same non-critical storage failure as above.
  }
}

/**
 * Item 127: the palette's own Ctrl/Cmd keydown handler already accepts either
 * modifier (`e.metaKey || e.ctrlKey`), so only the displayed hint was ever
 * Mac-only. `navigator.platform` doesn't change at runtime, so this is a
 * one-shot read of an external value, not state React owns — the same
 * `useSyncExternalStore` shape (and the same reasoning) as OfflineBanner's
 * `navigator.onLine` read, with a no-op subscribe since there's nothing to
 * listen for, and a fixed server snapshot since `navigator` doesn't exist
 * during SSR.
 */
function subscribeToNothing() {
  return () => {};
}

function getModifierLabelSnapshot(): string {
  const platform = navigator.platform || navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl";
}

function getModifierLabelServerSnapshot(): string {
  return "Ctrl";
}

function optionId(result: SearchResult): string {
  return `command-palette-option-${result.type}-${result.id}`;
}

export function CommandPalette() {
  const router = useRouter();
  const modifierLabel = useSyncExternalStore(subscribeToNothing, getModifierLabelSnapshot, getModifierLabelServerSnapshot);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  // Item 128: recent (localStorage, this browser only) + popular (real
  // follower counts, see getPopularTeams) for the zero state. recentSearches'
  // lazy initializer runs once on mount (server snapshot is always `[]`,
  // matching loadRecentSearches' own `typeof window === "undefined"` guard,
  // so this is hydration-safe) and is otherwise only ever updated directly
  // by saveRecentSearch/clearRecentSearches below — never inside an effect.
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());
  const [popularTeams, setPopularTeams] = useState<PopularTeam[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  // Bumped on every search actually fired so a slow earlier response can't
  // overwrite a faster later one (RECOMMENDATIONS item 85) — a response only
  // applies if its captured sequence number is still the latest when it
  // resolves.
  const searchSeqRef = useRef(0);

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

  // Popular teams is a real server round trip, fetched once when the palette
  // is first opened and cached for the session (a follower-count ranking
  // doesn't meaningfully change within one session) — not on every open.
  useEffect(() => {
    if (!open || popularTeams !== null) return;
    getPopularTeams()
      .then(setPopularTeams)
      .catch(() => setPopularTeams([]));
  }, [open, popularTeams]);

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
        searchSeqRef.current += 1; // invalidate any still in-flight search
        setResults([]);
        setActiveIndex(0);
        return;
      }
      const seq = ++searchSeqRef.current;
      startTransition(async () => {
        const next = await searchPlatform(query);
        if (seq !== searchSeqRef.current) return; // superseded by a newer search
        setResults(next);
        setActiveIndex(0);
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function navigateTo(result: SearchResult) {
    // Item 128: record the query that led here as a real, completed search
    // — only on an actual result selection, not every debounced keystroke.
    setRecentSearches(saveRecentSearch(query));
    router.push(`${TYPE_HREF[result.type]}/${result.id}`);
    close();
  }

  function goTo(href: string) {
    router.push(href);
    close();
  }

  function runRecentSearch(term: string) {
    setQuery(term);
    inputRef.current?.focus();
  }

  function handleClearRecentSearches() {
    clearRecentSearches();
    setRecentSearches([]);
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
        className="kivo-glass flex w-full max-w-md items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Search className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate text-foreground-subtle">Search teams, players, competitions…</span>
        <kbd className="hidden rounded border border-hairline px-1.5 py-0.5 text-[11px] text-foreground-subtle sm:inline-block">
          {modifierLabel}K
        </kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-overlay px-4 pt-24 backdrop-blur-sm"
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
              className="kivo-popover w-full max-w-lg overflow-hidden rounded-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 border-b border-hairline-soft px-4 py-3">
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
                  <div className="flex flex-col gap-4 px-1 py-3">
                    {recentSearches.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between px-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                            <Clock className="h-3 w-3" strokeWidth={2} />
                            Recent
                          </span>
                          <button
                            type="button"
                            onClick={handleClearRecentSearches}
                            className="flex items-center gap-1 rounded px-1 text-[11px] text-foreground-subtle transition hover:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                          >
                            <X className="h-3 w-3" strokeWidth={2} />
                            Clear
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {recentSearches.map((term) => (
                            <button
                              key={term}
                              type="button"
                              onClick={() => runRecentSearch(term)}
                              className="rounded-full border border-hairline px-3 py-1 text-xs text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                            >
                              {term}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {popularTeams && popularTeams.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-wide text-foreground-subtle">
                          <Flame className="h-3 w-3" strokeWidth={2} />
                          Popular teams
                        </span>
                        <div className="flex flex-col gap-0.5 px-1">
                          {popularTeams.map((team) => (
                            <button
                              key={team.id}
                              type="button"
                              onClick={() => goTo(`/teams/${team.id}`)}
                              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                            >
                              <TeamCrest crestUrl={team.crestUrl} name={team.name} size={20} />
                              <span className="min-w-0 flex-1 truncate">{team.name}</span>
                              <span className="text-[11px] text-foreground-subtle">
                                {team.followerCount} follower{team.followerCount === 1 ? "" : "s"}
                              </span>
                            </button>
                          ))}
                        </div>
                        {/* "Popular", not "Trending": a real follower count, not
                            time-windowed live activity KIVO doesn't track. */}
                      </div>
                    )}

                    <p className="px-2 text-center text-xs text-foreground-subtle">
                      Type at least 2 characters to search, or jump straight to a section.
                    </p>
                    <div className="grid grid-cols-2 gap-1.5 px-1">
                      {QUICK_LINKS.map((link) => {
                        const Icon = link.icon;
                        return (
                          <button
                            key={link.href}
                            type="button"
                            onClick={() => goTo(link.href)}
                            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                            {link.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : pending ? (
                  <div className="flex flex-col gap-1 p-1" aria-label="Searching" role="status">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <Skeleton className="h-3 w-36" />
                          <Skeleton className="h-2.5 w-20" />
                        </div>
                      </div>
                    ))}
                  </div>
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
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${
                          active ? "bg-surface-1" : ""
                        }`}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-1">
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
