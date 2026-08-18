/**
 * Recent searches, shared by the ⌘K command palette and the /search page.
 *
 * Real queries this browser actually completed — not user data. localStorage
 * is the right home: no new schema, and nothing here needs to sync across
 * devices or survive a cleared browser, the same standing this codebase
 * already gives onboarding dismissal flags. Extracted out of
 * command-palette.tsx when /search was built so a search made in one surface
 * shows up as recent in the other; two private copies of this list would have
 * been two different answers to the same question.
 *
 * Capped small and deduped case-insensitively, so retyping the same club name
 * doesn't pad the list with near-duplicates.
 */
const RECENT_SEARCHES_KEY = "kivo:recent-searches";
const MAX_RECENT_SEARCHES = 5;

export function loadRecentSearches(): string[] {
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

/** Records a real, completed search — called when the user actually navigates
 * to a result, not on every debounced keystroke, so the list holds genuine
 * finished searches rather than every half-typed prefix. */
export function saveRecentSearch(query: string): string[] {
  const trimmed = query.trim();
  if (typeof window === "undefined" || trimmed.length < 2) return loadRecentSearches();
  try {
    const deduped = loadRecentSearches().filter((q) => q.toLowerCase() !== trimmed.toLowerCase());
    const next = [trimmed, ...deduped].slice(0, MAX_RECENT_SEARCHES);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    return next;
  } catch {
    // Private browsing / storage quota — recent searches is a nicety, never
    // worth failing the actual navigation over.
    return loadRecentSearches();
  }
}

export function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Same non-critical storage failure as above.
  }
}
