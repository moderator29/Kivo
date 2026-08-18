/**
 * A tiny bounded, time-limited, in-process async cache.
 *
 * Built for KIVO_NEXT_GEN KN-18 (`buildGroundingContext` re-running its entire
 * 15-25 query retrieval on every single chat turn), and deliberately kept
 * general and dependency-free so the next expensive-but-slow-moving read can
 * use it without inventing a third caching mechanism.
 *
 * What this is not, said plainly so nobody mistakes it for more than it is:
 * it is per server instance, not shared, and it does not survive a cold start.
 * On serverless that makes it a real optimisation for a burst of requests from
 * the same user — which is exactly the shape a chat conversation has — and no
 * help at all across instances. That is the right trade here: a shared cache
 * would mean new infrastructure to run and a new place for stale football data
 * to hide, to save queries KIVO can already afford as long as they are not
 * being repeated once per keystroke-worth-of-conversation.
 *
 * Values are cached as **promises**, so N concurrent callers of the same key
 * share one execution rather than racing to do the same work N times. A
 * rejection is never cached.
 */

export interface TtlCache<K, V> {
  /** Returns the cached value for `key`, or runs `factory` and caches it. */
  getOrCreate(key: K, factory: () => Promise<V>): Promise<V>;
  /** Drops a key, e.g. because the underlying data was just written. */
  invalidate(key: K): void;
  clear(): void;
  /** Live entry count, for tests. */
  size(): number;
}

export function createTtlCache<K, V>(options: {
  ttlMs: number;
  /**
   * Hard ceiling on entries. Oldest-inserted is evicted first (a `Map`
   * preserves insertion order), which for a TTL cache is also the closest
   * entry to expiry. A cap matters more than the eviction policy's
   * sophistication: the point is that a cache keyed by user id can never grow
   * without bound on a long-lived server instance.
   */
  maxEntries: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}): TtlCache<K, V> {
  const { ttlMs, maxEntries } = options;
  const now = options.now ?? Date.now;
  const entries = new Map<K, { expiresAt: number; value: Promise<V> }>();

  function purgeExpired() {
    const t = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= t) entries.delete(key);
    }
  }

  return {
    getOrCreate(key, factory) {
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) return existing.value;

      const value = factory().catch((err: unknown) => {
        // Never cache a failure — the next caller should get a real attempt,
        // not a replayed error for the rest of the TTL.
        entries.delete(key);
        throw err;
      });

      entries.delete(key);
      entries.set(key, { expiresAt: now() + ttlMs, value });

      if (entries.size > maxEntries) {
        purgeExpired();
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next();
          if (oldest.done) break;
          entries.delete(oldest.value);
        }
      }

      return value;
    },
    invalidate(key) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    size() {
      purgeExpired();
      return entries.size;
    },
  };
}
