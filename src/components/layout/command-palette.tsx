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
import { Search, Shield, UserRound, Trophy, CalendarDays, CornerDownLeft, Clock, Flame, X, ArrowRight } from "lucide-react";
import { searchPlatform, getPopularTeams, type SearchResult, type PopularTeam } from "@/app/(app)/search-actions";
import { SEARCH_TYPE_META, searchResultHref } from "@/components/search/search-result-meta";
import { TeamCrest } from "@/components/ui/team-crest";
import { Skeleton } from "@/components/ui/skeleton";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { clearRecentSearches, loadRecentSearches, saveRecentSearch } from "@/lib/recent-searches";

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

// Item 128's recent-search store now lives in src/lib/recent-searches.ts —
// /search renders the same list, and two private copies of "what did this
// browser look for" would have been two different answers.

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

/**
 * `showTrigger` renders the palette's own search-bar button. The app shell
 * passes `false`: search has a real page and a real nav row now, so a third
 * visible entry point in the chrome would be exactly the clutter this pass
 * removed — inside the app the palette is the ⌘K accelerator over that page,
 * and the sidebar's Search row advertises the shortcut. `/not-found` still
 * passes nothing (defaulting to `true`), because there the palette is the only
 * thing a lost visitor has to type into.
 */
export function CommandPalette({ showTrigger = true }: { showTrigger?: boolean }) {
  const router = useRouter();
  const modifierLabel = useSyncExternalStore(subscribeToNothing, getModifierLabelSnapshot, getModifierLabelServerSnapshot);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  // Bug 2 (audit): `pending` only flips true once `startTransition` actually
  // runs, which doesn't happen until the 200ms debounce timer fires — so for
  // the ~200ms after every keystroke, neither `pending` nor `results` reflect
  // the query that's now in the input, and the render below would otherwise
  // fall into the "No matches" branch. `searchScheduled` closes that window;
  // the loading branch checks `pending || searchScheduled`.
  const [searchScheduled, setSearchScheduled] = useState(false);
  // Bug 6 (audit): distinguishes a real zero-result search from one that hit
  // searchPlatform's rate limit, which otherwise silently returns `[]` and
  // reads identically to "No matches".
  const [searchError, setSearchError] = useState<string | null>(null);
  // The query `searchScheduled`/`searchError` above currently reflect. React's
  // documented "adjusting state when a prop changes" pattern (same idiom
  // NotificationBell uses for focusSyncedUnreadCount) — comparing during
  // render and resetting synchronously with the *first* render of a new
  // query, rather than one tick later inside a useEffect, which is where
  // this used to live before react-hooks/set-state-in-effect flagged the
  // unconditional setState calls there as the derived-state anti-pattern
  // they were.
  const [scheduledForQuery, setScheduledForQuery] = useState(query);
  if (query !== scheduledForQuery) {
    setScheduledForQuery(query);
    setSearchScheduled(query.trim().length >= 2);
    setSearchError(null);
  }
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

  // Real focus trap + document-wide Escape-to-close + focus restore, same
  // shared hook every other dialog/sheet surface in the app uses (bug 1,
  // audit: this used to hand-roll its own Tab-trap effect with no Escape
  // handling at all, so Escape only closed the palette while focus was
  // literally inside the `<input>`, via handleKeyDown below).
  useFocusTrap(open, dialogRef, close, { restoreFocusRef: triggerRef });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      debounceRef.current = setTimeout(() => {
        searchSeqRef.current += 1; // invalidate any still in-flight search
        setResults([]);
        setActiveIndex(0);
      }, 200);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }

    debounceRef.current = setTimeout(() => {
      const seq = ++searchSeqRef.current;
      startTransition(async () => {
        const { error, results: next } = await searchPlatform(query);
        if (seq !== searchSeqRef.current) return; // superseded by a newer search
        setResults(next);
        setSearchError(error);
        setActiveIndex(0);
        // Bug 2/5 (audit): flips back off once this query's search has
        // actually resolved — flipping *on* happens synchronously at render
        // time above, the instant `query` changes, not here.
        setSearchScheduled(false);
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
    router.push(searchResultHref(result.type, result.id));
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
    // Escape is handled document-wide by useFocusTrap above (bug 1, audit) —
    // no longer needs its own case here, which only ever fired while focus
    // was literally inside this input.
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

  // Bugs 3/4/5 (audit): whether the real, roving-focus `role="option"` list is
  // what's actually rendered right now — as opposed to the zero-state
  // (Recent/Popular/Quick-links), the loading skeleton, the rate-limit error,
  // or "No matches", none of which are options. Drives the listbox role, the
  // input's aria-activedescendant, and nothing else — `aria-expanded` is kept
  // separate (see the input below) since the popup itself is showing content
  // in every one of those other states too.
  const showingResults = query.trim().length >= 2 && !pending && !searchScheduled && !searchError && results.length > 0;

  return (
    <>
      {showTrigger && (
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
      )}

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
                  aria-expanded={open}
                  aria-controls={LISTBOX_ID}
                  aria-autocomplete="list"
                  aria-activedescendant={showingResults && results[activeIndex] ? optionId(results[activeIndex]) : undefined}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Search teams, players, competitions…"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
                />
              </div>

              <div
                id={LISTBOX_ID}
                role={showingResults ? "listbox" : "group"}
                aria-label={showingResults ? "Search results" : undefined}
                className="max-h-80 overflow-y-auto p-2"
              >
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
                              className="rounded-xl border border-hairline px-3 py-1 text-xs text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
                    {/* The palette is the fast path over /search, not a
                        different search — this is the way back to the full
                        page, with recent searches and grouped results. */}
                    <button
                      type="button"
                      onClick={() => goTo("/search")}
                      className="mx-1 flex items-center justify-center gap-1.5 rounded-xl border border-hairline px-3 py-2 text-xs font-medium text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      Open the search page
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
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
                ) : pending || searchScheduled ? (
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
                ) : searchError ? (
                  <p className="px-3 py-6 text-center text-xs text-critical" role="status" aria-live="polite">
                    {searchError}
                  </p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-foreground-subtle">
                    No matches for &quot;{query}&quot;.
                  </p>
                ) : (
                  results.map((result, index) => {
                    const Icon = SEARCH_TYPE_META[result.type].icon;
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
                            {SEARCH_TYPE_META[result.type].group}
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
