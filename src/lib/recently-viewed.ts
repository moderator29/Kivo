// Purely client-side "recently viewed" tracking backed by localStorage.
// No backend involved: it only ever reflects what this browser has actually
// visited, so it's honest by construction for both guests and signed-in
// users. Every function here is safe to call from a server render too (SSR,
// or a browser with storage disabled/blocked in private mode) — they just
// no-op instead of throwing.

export type RecentlyViewedType = "team" | "player" | "league";

export type RecentlyViewedEntry = {
  type: RecentlyViewedType;
  id: string;
  name: string;
  imageUrl: string | null;
  viewedAt: number;
};

const STORAGE_KEY = "kivo:recently-viewed";
const MAX_ENTRIES = 12;
const EMPTY_ENTRIES: RecentlyViewedEntry[] = [];

function isRecentlyViewedType(value: unknown): value is RecentlyViewedType {
  return value === "team" || value === "player" || value === "league";
}

function isValidEntry(value: unknown): value is RecentlyViewedEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    isRecentlyViewedType(entry.type) &&
    typeof entry.id === "string" &&
    typeof entry.name === "string" &&
    (entry.imageUrl === null || typeof entry.imageUrl === "string") &&
    typeof entry.viewedAt === "number"
  );
}

// Caches the last-parsed result against the raw string it came from, so
// repeated reads of an unchanged localStorage value return the *same* array
// reference rather than a freshly-parsed one each time. useSyncExternalStore
// (see below) relies on that: a snapshot getter that returns a new
// reference every call looks like "always changing" and re-renders forever.
let cachedRaw: string | null = null;
let cachedEntries: RecentlyViewedEntry[] = EMPTY_ENTRIES;

function parse(raw: string | null): RecentlyViewedEntry[] {
  if (raw === cachedRaw) return cachedEntries;
  cachedRaw = raw;
  if (!raw) {
    cachedEntries = EMPTY_ENTRIES;
    return cachedEntries;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    cachedEntries = Array.isArray(parsed) ? parsed.filter(isValidEntry) : EMPTY_ENTRIES;
  } catch {
    // Corrupt JSON — treat it the same as "nothing viewed yet".
    cachedEntries = EMPTY_ENTRIES;
  }
  return cachedEntries;
}

function readList(): RecentlyViewedEntry[] {
  if (typeof window === "undefined") return EMPTY_ENTRIES;
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    // localStorage unavailable (private browsing, disabled) — treat it the
    // same as "nothing viewed yet" rather than throwing.
    return EMPTY_ENTRIES;
  }
}

/**
 * Snapshot getter for useSyncExternalStore's client read. Most-recently-
 * viewed first, capped at MAX_ENTRIES.
 */
export function getRecentlyViewed(): RecentlyViewedEntry[] {
  return readList();
}

/** Server/first-hydration-pass snapshot: the server never has localStorage. */
export function getRecentlyViewedServerSnapshot(): RecentlyViewedEntry[] {
  return EMPTY_ENTRIES;
}

/**
 * useSyncExternalStore subscribe function. The only realistic external
 * change while this component is mounted is another tab writing to the same
 * key, which the browser reports via the standard "storage" event (same-tab
 * writes don't fire it, which is fine: TrackView only ever runs on a
 * different page load than this strip).
 */
export function subscribeRecentlyViewed(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/**
 * Records a view, moving it to the front if already present (so revisiting
 * something bumps it back to "most recent" instead of duplicating it) and
 * trimming the list back down to MAX_ENTRIES.
 */
export function recordRecentlyViewed(entry: Omit<RecentlyViewedEntry, "viewedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const existing = readList().filter((e) => !(e.type === entry.type && e.id === entry.id));
    const next: RecentlyViewedEntry[] = [{ ...entry, viewedAt: Date.now() }, ...existing].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota exceeded, storage disabled, etc. — recording a view is a nice-to-
    // have, never something worth crashing a page render over.
  }
}
