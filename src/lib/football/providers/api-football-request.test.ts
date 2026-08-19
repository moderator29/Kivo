import { describe, expect, it, vi } from "vitest";
import { extractProviderError,
  ApiFootballError,
  classifyHttpError,
  classifyProviderErrorKind,
  describePlanRefusal,
  isRetryable,
  parseQuotaRemaining,
  parseSupportedSeasonRange,
  requestWithRetry,
} from "./api-football-request";

/** Minimal fetch Response stand-in — only the surface requestWithRetry actually
 * touches (ok, status, headers.get, json). */
function fakeResponse(status: number, opts: { quotaRemaining?: string | null; body?: unknown } = {}): Response {
  const { quotaRemaining = null, body = { response: [] } } = opts;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name === "x-ratelimit-requests-remaining" ? quotaRemaining : null),
    },
    json: async () => body,
  } as unknown as Response;
}

// Every test injects a no-op sleepImpl so retry-delay jitter never actually
// slows the suite down — the delay itself (retryDelayMs) isn't under test here.
const noSleep = async () => {};

describe("classifyHttpError", () => {
  it("classifies 429 as rate_limited with a quota-exhausted message", () => {
    const err = classifyHttpError(429, "/fixtures?date=2026-08-15", 0);
    expect(err.kind).toBe("rate_limited");
    expect(err.status).toBe(429);
    expect(err.quotaRemaining).toBe(0);
    expect(err.message).toContain("quota exhausted");
  });

  it("classifies 403 as auth with a bad-key message", () => {
    const err = classifyHttpError(403, "/fixtures?id=1", null);
    expect(err.kind).toBe("auth");
    expect(err.status).toBe(403);
    expect(err.message).toContain("API_FOOTBALL_KEY");
  });

  it("classifies 500 as server_error", () => {
    const err = classifyHttpError(500, "/fixtures?id=1", null);
    expect(err.kind).toBe("server_error");
  });

  it("classifies 503 as server_error", () => {
    expect(classifyHttpError(503, "/fixtures?id=1", null).kind).toBe("server_error");
  });

  it("classifies an unrecognised 4xx as client_error, distinct from rate_limited/auth", () => {
    const err = classifyHttpError(404, "/fixtures?id=1", null);
    expect(err.kind).toBe("client_error");
  });

  it("carries the quota-remaining value through onto the thrown error", () => {
    expect(classifyHttpError(429, "/x", 7).quotaRemaining).toBe(7);
    expect(classifyHttpError(500, "/x", 42).quotaRemaining).toBe(42);
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

describe("parseQuotaRemaining", () => {
  it("parses a plain numeric header value", () => {
    expect(parseQuotaRemaining("73")).toBe(73);
  });

  it("returns null for a missing header", () => {
    expect(parseQuotaRemaining(null)).toBeNull();
  });

  it("returns null for a non-numeric header value rather than crashing", () => {
    expect(parseQuotaRemaining("not-a-number")).toBeNull();
  });

  it("returns 0 (not null) for a genuinely exhausted quota", () => {
    expect(parseQuotaRemaining("0")).toBe(0);
  });
});

describe("requestWithRetry", () => {
  it("returns the response and quota on a first-attempt success, with no retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { quotaRemaining: "99" }));
    const sleepImpl = vi.fn(noSleep);

    const result = await requestWithRetry({
      path: "/fixtures?date=2026-08-15",
      url: "https://v3.football.api-sports.io/fixtures?date=2026-08-15",
      headers: {},
      revalidateSeconds: 300,
      fetchImpl,
      sleepImpl,
    });

    expect(result.quotaRemaining).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("retries once after a network error and succeeds on the second attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(fakeResponse(200, { quotaRemaining: "50" }));
    const sleepImpl = vi.fn(noSleep);

    const result = await requestWithRetry({
      path: "/fixtures?id=1",
      url: "https://v3.football.api-sports.io/fixtures?id=1",
      headers: {},
      revalidateSeconds: 300,
      fetchImpl,
      sleepImpl,
    });

    expect(result.quotaRemaining).toBe(50);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("throws a network_error ApiFootballError after two consecutive network errors, never a third attempt", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/fixtures?id=1",
        url: "https://v3.football.api-sports.io/fixtures?id=1",
        headers: {},
        revalidateSeconds: 300,
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "network_error" satisfies ApiFootballError["kind"] });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries once after a 5xx and succeeds on the second attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(503))
      .mockResolvedValueOnce(fakeResponse(200, { quotaRemaining: "12" }));
    const sleepImpl = vi.fn(noSleep);

    const result = await requestWithRetry({
      path: "/fixtures?id=1",
      url: "https://v3.football.api-sports.io/fixtures?id=1",
      headers: {},
      revalidateSeconds: 300,
      fetchImpl,
      sleepImpl,
    });

    expect(result.quotaRemaining).toBe(12);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
  });

  it("throws server_error after two consecutive 5xx responses, never a third attempt", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/fixtures?id=1",
        url: "https://v3.football.api-sports.io/fixtures?id=1",
        headers: {},
        revalidateSeconds: 300,
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "server_error", status: 500 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never retries a 429 — single attempt, immediate throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(429, { quotaRemaining: "0" }));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/fixtures?id=1",
        url: "https://v3.football.api-sports.io/fixtures?id=1",
        headers: {},
        revalidateSeconds: 300,
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "rate_limited", status: 429, quotaRemaining: 0 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("never retries a 403 — single attempt, immediate throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(403));
    const sleepImpl = vi.fn(noSleep);

    await expect(
      requestWithRetry({
        path: "/fixtures?id=1",
        url: "https://v3.football.api-sports.io/fixtures?id=1",
        headers: {},
        revalidateSeconds: 300,
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
        path: "/fixtures?id=999999",
        url: "https://v3.football.api-sports.io/fixtures?id=999999",
        headers: {},
        revalidateSeconds: 300,
        fetchImpl,
        sleepImpl,
      }),
    ).rejects.toMatchObject({ kind: "client_error", status: 404 });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("still reports quota-remaining on a thrown error, not just on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(429, { quotaRemaining: "3" }));

    const err: ApiFootballError = await requestWithRetry({
      path: "/fixtures?id=1",
      url: "https://v3.football.api-sports.io/fixtures?id=1",
      headers: {},
      revalidateSeconds: 300,
      fetchImpl,
      sleepImpl: noSleep,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiFootballError);
    expect(err.quotaRemaining).toBe(3);
  });
});

describe("extractProviderError", () => {
  it("reads the real suspended-account body that shipped a silent empty sync", () => {
    // Captured verbatim from the live project's sync_runs.raw_response_sample
    // on 2026-08-19. HTTP 200, results 0, empty response array — which is
    // exactly what a quiet day with no matches looks like.
    const body = {
      get: "fixtures",
      parameters: { date: "2026-08-19" },
      errors: { access: "Your account is suspended, check on https://dashboard.api-football.com." },
      results: 0,
      paging: { current: 1, total: 1 },
      response: [],
    };
    expect(extractProviderError(body)).toEqual({
      key: "access",
      message: "Your account is suspended, check on https://dashboard.api-football.com.",
    });
  });

  it("treats a successful call's empty errors array as no error", () => {
    expect(extractProviderError({ errors: [], results: 12, response: [{}] })).toBeNull();
  });

  it("returns null rather than throwing on shapes the provider never documented", () => {
    expect(extractProviderError(null)).toBeNull();
    expect(extractProviderError(undefined)).toBeNull();
    expect(extractProviderError("not json")).toBeNull();
    expect(extractProviderError({})).toBeNull();
    expect(extractProviderError({ errors: null })).toBeNull();
    expect(extractProviderError({ errors: {} })).toBeNull();
    // A key present but blank is not a message worth surfacing.
    expect(extractProviderError({ errors: { access: "   " } })).toBeNull();
    // Non-string values are ignored rather than stringified into noise.
    expect(extractProviderError({ errors: { rateLimit: 42 } })).toBeNull();
  });

  it("reads an errors array, which some endpoints use instead of an object", () => {
    expect(extractProviderError({ errors: ["Plan does not allow this endpoint."] })).toEqual({
      key: "0",
      message: "Plan does not allow this endpoint.",
    });
  });
});

describe("classifyProviderErrorKind", () => {
  it("classifies the provider's own `plan` key as a plan refusal, not a client error", () => {
    // The live database recorded exactly this under `client_error`, which is
    // why "check your API key" was the wrong advice for a whole day.
    expect(
      classifyProviderErrorKind("plan", "Free plans do not have access to this season, try from 2022 to 2024."),
    ).toBe("plan");
  });

  it("keeps account problems as auth — they are fixed somewhere else entirely", () => {
    expect(classifyProviderErrorKind("access", "Your account is suspended.")).toBe("auth");
    expect(classifyProviderErrorKind("token", "Invalid API key.")).toBe("auth");
  });

  it("reads the sentence when the key is generic but the message is about the plan", () => {
    expect(classifyProviderErrorKind("season", "Free plans do not have access to this season.")).toBe("plan");
    expect(classifyProviderErrorKind("endpoint", "Please upgrade your plan to use this endpoint.")).toBe("plan");
  });

  it("leaves an ordinary parameter complaint as a client error", () => {
    expect(classifyProviderErrorKind("date", "The Date field must be a valid date.")).toBe("client_error");
  });
});

describe("parseSupportedSeasonRange", () => {
  it("pulls the seasons the provider named out of its own sentence", () => {
    expect(parseSupportedSeasonRange("Free plans do not have access to this season, try from 2022 to 2024.")).toEqual({
      from: 2022,
      to: 2024,
    });
  });

  it("returns null rather than guessing when no range is named", () => {
    expect(parseSupportedSeasonRange("Free plans do not have access to this season.")).toBeNull();
    // A wrong range would send an operator to a season that is also refused.
    expect(parseSupportedSeasonRange("try from 2024 to 2022")).toBeNull();
  });
});

describe("describePlanRefusal", () => {
  const providerMessage = "Free plans do not have access to this season, try from 2022 to 2024.";

  it("leads with what to do and keeps the provider's own words attached", () => {
    const message = describePlanRefusal(providerMessage, "/standings?league=39&season=2026");
    expect(message).toContain("does not cover season 2026");
    expect(message).toContain("2022 to 2024");
    expect(message).toContain("target season");
    // KIVO must never present its paraphrase as if it were the provider's
    // statement, so the raw sentence travels with it.
    expect(message).toContain(providerMessage);
  });

  it("still gives an instruction when the provider named no range and the path has no season", () => {
    const message = describePlanRefusal("This endpoint is not available on your plan.", "/leagues");
    expect(message).toContain("does not cover this request");
    expect(message).toContain("target season");
  });
});
