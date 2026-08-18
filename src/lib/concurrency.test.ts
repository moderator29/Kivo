import { describe, expect, it } from "vitest";
import { createAsyncMemo, createKeyedSerializer, mapWithConcurrency } from "./concurrency";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("mapWithConcurrency", () => {
  it("returns results in input order, not completion order", async () => {
    const out = await mapWithConcurrency([30, 10, 20, 0], 2, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20, 0]);
  });

  it("never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 25 }, (_, i) => i), 4, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
    });
    expect(peak).toBe(4);
  });

  it("handles an empty list and a nonsense limit without spinning", async () => {
    expect(await mapWithConcurrency([], 8, async () => 1)).toEqual([]);
    expect(await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2)).toEqual([2, 4, 6]);
  });

  it("rejects if a worker rejects", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

describe("createAsyncMemo", () => {
  it("shares one in-flight call between concurrent callers of the same key", async () => {
    const memo = createAsyncMemo<string, number>();
    let calls = 0;
    const gate = deferred<void>();
    const factory = async () => {
      calls += 1;
      await gate.promise;
      return 42;
    };

    const all = Promise.all([memo("a", factory), memo("a", factory), memo("a", factory)]);
    gate.resolve();
    expect(await all).toEqual([42, 42, 42]);
    // The whole point: a plain value cache would have let all three miss.
    expect(calls).toBe(1);
  });

  it("keeps different keys independent", async () => {
    const memo = createAsyncMemo<string, string>();
    expect(await memo("a", async () => "A")).toBe("A");
    expect(await memo("b", async () => "B")).toBe("B");
    expect(await memo("a", async () => "changed")).toBe("A");
  });

  it("does not cache a rejection, so a later item can retry", async () => {
    const memo = createAsyncMemo<string, string>();
    await expect(memo("a", async () => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    await expect(memo("a", async () => "recovered")).resolves.toBe("recovered");
  });
});

describe("createKeyedSerializer", () => {
  it("runs same-key tasks one at a time and different keys concurrently", async () => {
    const serialize = createKeyedSerializer<string>();
    const order: string[] = [];
    const step = async (label: string, ms: number) => {
      order.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${label}:end`);
    };

    await Promise.all([
      serialize("x", () => step("x1", 10)),
      serialize("x", () => step("x2", 1)),
      serialize("y", () => step("y1", 1)),
    ]);

    // x2 must not start before x1 finished.
    expect(order.indexOf("x2:start")).toBeGreaterThan(order.indexOf("x1:end"));
    // y1 is a different key, so it did not wait for the slow x1.
    expect(order.indexOf("y1:start")).toBeLessThan(order.indexOf("x1:end"));
  });

  it("lets a later same-key task run after an earlier one rejected", async () => {
    const serialize = createKeyedSerializer<string>();
    const failing = serialize("k", async () => {
      throw new Error("first failed");
    });
    const following = serialize("k", async () => "second ran");

    await expect(failing).rejects.toThrow("first failed");
    await expect(following).resolves.toBe("second ran");
  });
});
