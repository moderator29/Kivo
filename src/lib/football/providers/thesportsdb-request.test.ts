import { describe, expect, it, vi } from "vitest";
import { TheSportsDbError, classifyHttpError, isRetryable, requestWithRetry } from "./thesportsdb-request";

/** Minimal fetch Response stand-in — only the surface requestWithRetry actually
 * touches (ok, status, json). Unlike API-Football's, no quota header to fake. */
function fakeResponse(status: number, body: unknown = { events: [] }): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Every test injects a no-op sleepImpl so retry-delay jitter never actually
// slows the suite down — the delay itself (retryDelayMs) isn't under test here.
const noSleep = async () => {};

describe("classifyHttpError", () => {
  it("classifies 429 as rate_limited with a rate-limit message", () => {
    const err = classifyHttpError(429, "/eventsday.php?d=2026-08-15");
    expect(err.kind).toBe("rate_limited");
    expect(err.status).toBe(429);
    expect(err.message).toContain("rate limit");
  });

  it("classifies 401 as auth with a bad-key message", () => {
    const err = classifyHttpError(401, "/lookupevent.php?id=1");
    expect(err.kind).toBe("auth");
    expect(err.message).toContain("THE_SPORTS_DB_API_KEY");
  });

  it("classifies 403 as auth with a bad-key message", () => {
    const err = classifyHttpError(403, "/lookupevent.php?id=1");
    expect(err.kind).toBe("auth");
    expect(err.message).toContain("THE_SPORTS_DB_API_KEY");
  });

  it("classifies 500 as server_error", () => {
    expect(classifyHttpError(500, "/lookupevent.php?id=1").kind).toBe("server_error");
  });

  it("classifies 503 as server_error", () => {
    expect(classifyHttpError(503, "/lookupevent.php?id=1").kind).toBe("server_error");
  });

  it("classifies an unrecognised 4xx as client_error, distinct from rate_limited/auth", () => {
    expect(classifyHttpError(404, "/lookupevent.php?id=1").kind).toBe("client_error");
  });
});

describe("isRetryable", () => {
  it("is retryable for server_error and network_error", () => {
    expect(isRetryable("server_error")).toBe(true);
    expect(isRetryable("network_error")).toBe(true);
  });

  it("is never retryable for rate_limited, auth, or client_error", () => {
    expect(isRetryable("rate_limited")).toBe(false);
    expect(isRetryable("auth")).toBe(false);
    expect(isRetryable("client_error")).toBe(false);
  });
});

describe("requestWithRetry", () => {
  it("returns the parsed JSON body on a first-attempt success, with no retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { events: [{ idEvent: "1" }] }));
    const sleepImpl = vi.fn(noSleep);

    const result = await requestWithRetry<{ events: unknown[] }>({
      path: "/eventsday.php?d=2026-08-15",
      url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
      fetchImpl,
      sleepImpl,
    });

    expect(result.events).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("retries once after a network error and succeeds on the second attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(fakeResponse(200, { events: [] }));
    const sleepImpl = vi.fn(noSleep);

    await requestWithRetry({
      path: "/eventsday.php?d=2026-08-15",
      url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
      fetchImpl,
      sleepImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a network_error TheSportsDbError after two consecutive network errors, never a third attempt", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/eventsday.php?d=2026-08-15",
        url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "network_error" satisfies TheSportsDbError["kind"] });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once after a 5xx and succeeds on the second attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(fakeResponse(503)).mockResolvedValueOnce(fakeResponse(200));
    const sleepImpl = vi.fn(noSleep);

    await requestWithRetry({
      path: "/eventsday.php?d=2026-08-15",
      url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
      fetchImpl,
      sleepImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("throws server_error after two consecutive 5xx responses, never a third attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/eventsday.php?d=2026-08-15",
        url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "server_error", status: 500 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries a 429 — single attempt, immediate throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(429));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/eventsday.php?d=2026-08-15",
        url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "rate_limited", status: 429 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("never retries a 401/403 — single attempt, immediate throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(403));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/eventsday.php?d=2026-08-15",
        url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "auth", status: 403 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("never retries an unrecognised 4xx (e.g. 404) — single attempt, immediate throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(404));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/eventsday.php?d=2026-08-15",
        url: "https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-08-15",
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "client_error", status: 404 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
