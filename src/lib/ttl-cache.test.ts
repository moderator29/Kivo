import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache";

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createTtlCache", () => {
  it("serves a cached value within the TTL and re-runs after it", async () => {
    const c = clock();
    const cache = createTtlCache<string, number>({ ttlMs: 100, maxEntries: 10, now: c.now });
    const factory = vi.fn(async () => 1);

    expect(await cache.getOrCreate("k", factory)).toBe(1);
    c.advance(99);
    expect(await cache.getOrCreate("k", factory)).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);

    c.advance(2);
    expect(await cache.getOrCreate("k", factory)).toBe(1);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("shares one execution between concurrent callers of the same key", async () => {
    const cache = createTtlCache<string, number>({ ttlMs: 1000, maxEntries: 10 });
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const factory = async () => {
      calls += 1;
      await gate;
      return 7;
    };

    const all = Promise.all([cache.getOrCreate("k", factory), cache.getOrCreate("k", factory)]);
    release();
    expect(await all).toEqual([7, 7]);
    expect(calls).toBe(1);
  });

  it("never caches a rejection", async () => {
    const cache = createTtlCache<string, string>({ ttlMs: 1000, maxEntries: 10 });
    await expect(cache.getOrCreate("k", async () => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    await expect(cache.getOrCreate("k", async () => "recovered")).resolves.toBe("recovered");
  });

  it("keeps different keys independent and honours invalidate", async () => {
    const cache = createTtlCache<string, string>({ ttlMs: 1000, maxEntries: 10 });
    expect(await cache.getOrCreate("a", async () => "A")).toBe("A");
    expect(await cache.getOrCreate("b", async () => "B")).toBe("B");
    expect(await cache.getOrCreate("a", async () => "ignored")).toBe("A");
    cache.invalidate("a");
    expect(await cache.getOrCreate("a", async () => "fresh")).toBe("fresh");
  });

  it("never grows past maxEntries", async () => {
    const cache = createTtlCache<number, number>({ ttlMs: 60_000, maxEntries: 3 });
    for (let i = 0; i < 25; i += 1) await cache.getOrCreate(i, async () => i);
    expect(cache.size()).toBe(3);
    // The most recent keys survive; the oldest were evicted.
    expect(await cache.getOrCreate(24, async () => -1)).toBe(24);
    expect(await cache.getOrCreate(0, async () => -1)).toBe(-1);
  });

  it("drops expired entries from its own size accounting", async () => {
    const c = clock();
    const cache = createTtlCache<string, string>({ ttlMs: 50, maxEntries: 10, now: c.now });
    await cache.getOrCreate("a", async () => "A");
    expect(cache.size()).toBe(1);
    c.advance(51);
    expect(cache.size()).toBe(0);
  });
});
