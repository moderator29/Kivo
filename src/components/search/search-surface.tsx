"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Search, X, Clock, Flame } from "lucide-react";
import { motion } from "motion/react";
import { searchPlatform, type PopularTeam, type SearchResult } from "@/app/(app)/search-actions";
import { SEARCH_TYPE_META, SEARCH_TYPE_ORDER, searchResultHref } from "./search-result-meta";
import { TeamCrest } from "@/components/ui/team-crest";
import { ListRow, ListSurface } from "@/components/ui/list-surface";
import { ListSkeleton } from "@/components/ui/skeletons";
import { EmptyState, InlineError } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { searchEmptyExplanation, type SearchCoverage } from "@/lib/search-coverage";
import {
  clearRecentSearches,
  loadRecentSearches,
  saveRecentSearch,
} from "@/lib/recent-searches";

/** Everywhere a search can start from that is not a search result: the five
 * entity indexes searchPlatform covers, plus the two browse surfaces a person
 * looking for "a match" or "a transfer" actually wants. Real routes only. */
const BROWSE_LINKS = [
  { label: "Teams", href: "/teams", type: "team" as const },
  { label: "Players", href: "/players", type: "player" as const },
  { label: "Competitions", href: "/leagues", type: "competition" as const },
  { label: "Managers", href: "/managers", type: "manager" as const },
  { label: "Venues", href: "/venues", type: "venue" as const },
];

/**
 * The search *page*.
 *
 * Search used to live only in a cramped top-bar field that opened a modal.
 * The founder asked for it to be removed from the chrome and given a real
 * structured home, and there are two genuinely different jobs here:
 *
 *  - ⌘K, for someone who already knows the name they want and wants to be
 *    gone in under a second. That is the command palette, and it stays.
 *  - "Show me what KIVO has", which is browsing: it needs scroll, grouped
 *    results, a back button, and a URL you can share or bookmark. A modal is
 *    the wrong container for that, and on a phone — where there is no ⌘K at
 *    all — it was the *only* container.
 *
 * So: both. This page is the mobile-primary surface and the shareable one;
 * the palette is the keyboard shortcut over the same `searchPlatform` action,
 * the same `SEARCH_TYPE_META`, and the same recent-search store, so the two
 * can never disagree about what a result is or where it goes.
 */
export function SearchSurface({
  initialQuery,
  initialResults,
  initialError,
  popularTeams,
  coverage,
  variant = "page",
}: {
  initialQuery: string;
  initialResults: SearchResult[];
  initialError: string | null;
  popularTeams: PopularTeam[];
  /** What the index actually holds, so an empty result can explain itself
   * with real numbers instead of implying the query was misspelled. */
  coverage: SearchCoverage;
  /**
   * `"page"` is /search: autofocused, owns the URL, and fills its zero state
   * with recents, popular clubs and browse links.
   *
   * `"inline"` is Discover, where this sits at the top of a page that is
   * *already* a browse surface. It does not steal focus on arrival, does not
   * rewrite Discover's URL, and renders nothing at all until someone types —
   * the zero state below it is the Discover grid itself, and repeating the
   * browse links above it would be the same list twice.
   */
  variant?: "page" | "inline";
}) {
  const inline = variant === "inline";
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>(initialResults);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();
  const [scheduled, setScheduled] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => loadRecentSearches());
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same guard the palette uses: a slow earlier response must never overwrite
  // a faster later one.
  const seqRef = useRef(0);
  // The query `scheduled`/`error` currently describe. Compared during render
  // rather than synced in an effect, so the first render of a new query
  // already knows a search is coming and never flashes "No matches".
  const [describedQuery, setDescribedQuery] = useState(query);
  if (query !== describedQuery) {
    setDescribedQuery(query);
    setScheduled(query.trim().length >= 2);
    setError(null);
  }

  const trimmed = query.trim();

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (trimmed.length < 2) {
      debounceRef.current = setTimeout(() => {
        seqRef.current += 1;
        setResults([]);
      }, 200);
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }

    debounceRef.current = setTimeout(() => {
      const seq = ++seqRef.current;
      startTransition(async () => {
        const { error: nextError, results: next } = await searchPlatform(trimmed);
        if (seq !== seqRef.current) return;
        setResults(next);
        setError(nextError);
        setScheduled(false);
        // Shareable/bookmarkable without a server round trip per keystroke:
        // the results are already client state, so a full navigation would
        // only re-fetch what is on screen. History is replaced, not pushed,
        // so Back leaves search rather than walking every prefix typed.
        //
        // Only on /search. Writing ?q= onto /discover would produce a URL
        // that renders the browse hub with a query string it does not honour
        // on load — a link that lies about where it lands.
        if (!inline) {
          const url = new URL(window.location.href);
          url.searchParams.set("q", trimmed);
          window.history.replaceState(null, "", url.toString());
        }
      });
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimmed, inline]);

  const remember = useCallback(() => {
    setRecent(saveRecentSearch(trimmed));
  }, [trimmed]);

  function clearQuery() {
    setQuery("");
    inputRef.current?.focus();
    if (inline) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    window.history.replaceState(null, "", url.toString());
  }

  const searching = pending || scheduled;
  const grouped = SEARCH_TYPE_ORDER.map((type) => ({
    type,
    items: results.filter((result) => result.type === type),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {/* One field, full width, 48px tall — the thing this page exists for,
          not a 200px slot squeezed between a logo and an avatar. */}
      <div className="kivo-glass flex items-center gap-3 rounded-2xl px-4 py-3 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_var(--accent-hairline),0_8px_30px_-8px_var(--accent-hairline)]">
        <Search className="h-[18px] w-[18px] shrink-0 text-foreground-subtle" strokeWidth={1.75} />
        <input
          ref={inputRef}
          type="search"
          // The one field on a page called Search: focusing it on arrival is
          // what the person came for, and there is nothing above it to scroll
          // past on a phone. On Discover it must NOT steal focus — the page
          // has a heading and a grid the person may well have come for, and a
          // keyboard springing up over them on a phone is hostile.
          autoFocus={!inline}
          enterKeyHint="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search KIVO"
          placeholder={inline ? "Search clubs, players, competitions…" : "Teams, players, competitions, managers, venues"}
          className="min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-foreground-subtle focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query.length > 0 && (
          <button
            type="button"
            onClick={clearQuery}
            aria-label="Clear search"
            className="kivo-focus -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground-subtle transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {trimmed.length < 2 ? (
        inline ? null : (
        <div className="flex flex-col gap-6">
          {recent.length > 0 && (
            <Section
              title="Recent"
              icon={<Clock className="h-3 w-3" strokeWidth={2} />}
              action={
                <button
                  type="button"
                  onClick={() => {
                    clearRecentSearches();
                    setRecent([]);
                  }}
                  className="kivo-focus rounded px-1 text-[11px] font-medium text-foreground-subtle transition-colors hover:text-foreground-muted"
                >
                  Clear
                </button>
              }
            >
              <div className="flex flex-wrap gap-2">
                {recent.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      setQuery(term);
                      inputRef.current?.focus();
                    }}
                    className="kivo-focus rounded-xl border border-hairline px-3.5 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    {term}
                  </button>
                ))}
              </div>
            </Section>
          )}

          {popularTeams.length > 0 && (
            <Section title="Popular teams" icon={<Flame className="h-3 w-3" strokeWidth={2} />}>
              {/* "Popular", never "Trending": a real follower count, not
                  time-windowed activity KIVO does not record. */}
              <ListSurface>
                {popularTeams.map((team) => (
                  <ListRow
                    key={team.id}
                    href={`/teams/${team.id}`}
                    leading={<TeamCrest crestUrl={team.crestUrl} name={team.name} size={24} />}
                    title={team.name}
                    subtitle={`${team.followerCount} follower${team.followerCount === 1 ? "" : "s"}`}
                  />
                ))}
              </ListSurface>
            </Section>
          )}

          <Section title="Browse everything">
            <ListSurface>
              {BROWSE_LINKS.map((link) => {
                const Icon = SEARCH_TYPE_META[link.type].icon;
                return (
                  <ListRow
                    key={link.href}
                    href={link.href}
                    chevron
                    leading={
                      <Icon className="h-[18px] w-[18px] text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
                    }
                    title={link.label}
                  />
                );
              })}
            </ListSurface>
          </Section>
        </div>
        )
      ) : searching ? (
        // FRONTEND SWEEP 2026-08-19: five stacked glass cards, standing in for
        // results that arrive as one surface with divided rows. Every search
        // therefore ended in a reflow — five boxes collapsing into one panel —
        // at the exact moment the reader started scanning.
        //
        // Now it is <ListSkeleton> in front of <ListSurface>, which is the only
        // version of this that cannot drift: the two read their geometry from
        // the same primitive, so a change to the row changes both.
        <div className="flex flex-col gap-2" role="status" aria-label="Searching">
          <Skeleton className="mx-1 h-3 w-24" />
          <ListSkeleton rows={5} leading="circle" subtitle />
        </div>
      ) : error ? (
        // A failed search is a failed read, not an empty result, and the two
        // must not look alike — <InlineError> is one hairline row inside the
        // space the results would have filled, so a retype does not reflow the
        // page. The raw message is deliberately dropped: it is written for a
        // log, and "Search didn't load just now" is the whole of what the
        // reader can act on.
        <InlineError what="Search" />
      ) : grouped.length === 0 ? (
        <EmptyState
          icon={Search}
          tone="section"
          title={`No matches for \u201C${trimmed}\u201D`}
          description={searchEmptyExplanation(coverage)}
        />
      ) : (
        <div className="flex flex-col gap-6" aria-live="polite">
          {grouped.map((group, groupIndex) => (
            <motion.div
              key={group.type}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: groupIndex * 0.03, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col gap-2"
            >
              <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                {SEARCH_TYPE_META[group.type].group}
              </h2>
              <ListSurface>
                {group.items.map((result) => {
                  const Icon = SEARCH_TYPE_META[result.type].icon;
                  return (
                    <ListRow
                      key={`${result.type}-${result.id}`}
                      href={searchResultHref(result.type, result.id)}
                      onClick={remember}
                      chevron
                      leading={
                        result.imageUrl ? (
                          <TeamCrest crestUrl={result.imageUrl} name={result.label} size={28} />
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-1">
                            <Icon className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
                          </span>
                        )
                      }
                      title={result.label}
                      subtitle={result.sublabel ?? undefined}
                    />
                  );
                })}
              </ListSurface>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
