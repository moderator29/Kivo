/**
 * A bounded worker pool for I/O-bound loops (KIVO_NEXT_GEN KN-11/KN-12).
 *
 * The football sync paths are long `for … await` loops over a provider's whole
 * response — hundreds of fixtures, each costing several sequential Supabase
 * round trips. On a serverless function with a wall-clock timeout that is the
 * shape most likely to be killed part-way through, and `Promise.all` over the
 * whole array is not the fix: it replaces one long queue with an unbounded
 * burst that can exhaust the connection pool and turns one slow row into
 * hundreds of simultaneous open requests.
 *
 * Deliberately dependency-free and free of `server-only` so it is unit
 * testable, and deliberately tiny — a `p-limit` dependency for twenty lines
 * would be the wrong trade in a repo with this few runtime dependencies.
 */

/**
 * Runs `worker` over `items` with at most `limit` in flight at once, and
 * returns the results **in input order** regardless of completion order.
 *
 * A rejected worker rejects the whole call, exactly like `Promise.all` — the
 * sync callers each catch per item inside their own worker so one bad fixture
 * never aborts the batch, which is a decision that belongs at the call site,
 * not here.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const effectiveLimit = Math.max(1, Math.min(Math.floor(limit), items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runLane(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, runLane));
  return results;
}

/**
 * Memoizes an async factory by key **including in-flight calls**, so N
 * concurrent callers asking for the same key share one round trip rather than
 * racing to do the same work N times.
 *
 * This is what makes `mapWithConcurrency` safe over the sync loops: those loops
 * resolve shared entities (a competition's season, a team's mapping) that
 * dozens of fixtures in the same batch reference. A plain
 * `Map<key, value>` memo only helps a *sequential* loop — under concurrency
 * every lane misses the map before any of them fills it. Caching the promise
 * rather than the value closes that window.
 *
 * A rejection is not cached: the entry is dropped so a later item can retry,
 * matching the existing per-fixture "one bad row doesn't poison the batch"
 * behaviour.
 */
export function createAsyncMemo<K, V>(): (key: K, factory: () => Promise<V>) => Promise<V> {
  const inFlight = new Map<K, Promise<V>>();
  return (key, factory) => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = factory().catch((err: unknown) => {
      inFlight.delete(key);
      throw err;
    });
    inFlight.set(key, promise);
    return promise;
  };
}

/**
 * Serializes async work per key: calls sharing a key run one after another,
 * calls with different keys run freely.
 *
 * Needed by `upsertSeason`, whose two `is_current` updates only stay correct
 * against `idx_seasons_one_current_per_competition` (at most one current
 * season per competition) if no other season of the *same competition* is
 * being flipped at the same moment. Memoizing by `(competition, year)` is not
 * enough on its own — two different years of one competition are different
 * keys and would otherwise interleave.
 */
export function createKeyedSerializer<K>(): <V>(key: K, task: () => Promise<V>) => Promise<V> {
  const tails = new Map<K, Promise<unknown>>();
  return <V>(key: K, task: () => Promise<V>): Promise<V> => {
    const previous = tails.get(key) ?? Promise.resolve();
    // Swallow the predecessor's rejection when chaining so one failure does not
    // cascade into every later task queued behind it — the caller still sees
    // its own task's own rejection.
    const next = previous.then(task, task);
    tails.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}
