import { describe, expect, it, vi } from "vitest";
import {
  KivoProviderError,
  backoffDelayMs,
  classifyStatusKind,
  describeStatusFailure,
  isRetryableKind,
  parseQuotaRemaining,
  parseRetryAfterSeconds,
  redactProviderSecrets,
  requestProvider,
  toKivoProviderError,
  userFacingProviderMessage,
  type ProviderErrorKind,
  type ProviderRequestOutcome,
} from "./provider-request";

/** Minimal Response stand-in — only what requestProvider touches. */
function fakeResponse(status: number, headers: Record<string, string> = {}): Response {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => lower[name.toLowerCase()] ?? null },
    json: async () => ({}),
  } as unknown as Response;
}

const noSleep = async () => {};

describe("classifyStatusKind", () => {
  it("separates the two credential statuses from the plan one", () => {
    expect(classifyStatusKind(401)).toBe("auth");
    expect(classifyStatusKind(403)).toBe("auth");
    // 402 is literally Payment Required, and telling somebody to check their key
    // when the plan is the problem costs them a day.
    expect(classifyStatusKind(402)).toBe("plan");
  });

  it("gives 404 its own kind rather than flattening it into client_error", () => {
    expect(classifyStatusKind(404)).toBe("not_found");
    expect(classifyStatusKind(400)).toBe("client_error");
    expect(classifyStatusKind(422)).toBe("client_error");
  });

  it("classifies rate limiting, server failure and gateway timeout", () => {
    expect(classifyStatusKind(429)).toBe("rate_limited");
    expect(classifyStatusKind(500)).toBe("server_error");
    expect(classifyStatusKind(503)).toBe("server_error");
    expect(classifyStatusKind(504)).toBe("timeout");
    expect(classifyStatusKind(408)).toBe("timeout");
  });
});

describe("isRetryableKind", () => {
  it("retries only what a second attempt could fix", () => {
    expect(isRetryableKind("server_error")).toBe(true);
    expect(isRetryableKind("network_error")).toBe(true);
    expect(isRetryableKind("timeout")).toBe(true);
  });

  it("never retries a rate limit — that spends another request against a limit already reached", () => {
    expect(isRetryableKind("rate_limited")).toBe(false);
  });

  it("never retries the failures a second attempt cannot change", () => {
    for (const kind of ["auth", "plan", "not_found", "client_error"] satisfies ProviderErrorKind[]) {
      expect(isRetryableKind(kind)).toBe(false);
    }
  });
});

describe("backoffDelayMs", () => {
  it("grows the window exponentially rather than holding it flat", () => {
    const always1 = () => 0.999_999;
    const first = backoffDelayMs(1, { baseMs: 100, random: always1 });
    const second = backoffDelayMs(2, { baseMs: 100, random: always1 });
    const third = backoffDelayMs(3, { baseMs: 100, random: always1 });
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it("caps the window so a long outage cannot produce an absurd wait", () => {
    expect(backoffDelayMs(20, { baseMs: 250, maxMs: 8_000, random: () => 0.999_999 })).toBeLessThanOrEqual(8_000);
  });

  it("uses full jitter — the whole window is reachable, including near zero", () => {
    expect(backoffDelayMs(3, { baseMs: 100, random: () => 0 })).toBe(0);
  });
});

describe("parseRetryAfterSeconds", () => {
  it("reads the delta-seconds form", () => {
    expect(parseRetryAfterSeconds("120")).toBe(120);
  });

  it("reads the HTTP-date form as seconds from now", () => {
    const now = Date.parse("2026-08-19T12:00:00Z");
    expect(parseRetryAfterSeconds("Wed, 19 Aug 2026 12:00:30 GMT", now)).toBe(30);
  });

  it("clamps a date already in the past to zero rather than going negative", () => {
    const now = Date.parse("2026-08-19T12:00:00Z");
    expect(parseRetryAfterSeconds("Wed, 19 Aug 2026 11:59:00 GMT", now)).toBe(0);
  });

  it("returns null for an absent or unparseable header — not zero, which reads as 'go now'", () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(parseRetryAfterSeconds("soon")).toBeNull();
    expect(parseRetryAfterSeconds("")).toBeNull();
  });
});

describe("parseQuotaRemaining", () => {
  it("takes the first candidate header that is present and numeric", () => {
    const headers = fakeResponse(200, { "x-requests-available-minute": "9" }).headers;
    expect(parseQuotaRemaining(headers, ["x-ratelimit-requests-remaining", "x-requests-available-minute"])).toBe(9);
  });

  it("returns null when no candidate is present — the honest 'not reported'", () => {
    expect(parseQuotaRemaining(fakeResponse(200).headers, ["x-anything"])).toBeNull();
  });

  it("returns 0 for a genuinely exhausted quota, which is not the same as unknown", () => {
    const headers = fakeResponse(200, { "x-ratelimit-requests-remaining": "0" }).headers;
    expect(parseQuotaRemaining(headers, ["x-ratelimit-requests-remaining"])).toBe(0);
  });

  it("skips a non-numeric value rather than crashing on it", () => {
    const headers = fakeResponse(200, { a: "unlimited", b: "5" }).headers;
    expect(parseQuotaRemaining(headers, ["a", "b"])).toBe(5);
  });
});

describe("redactProviderSecrets", () => {
  it("removes a literal key value wherever it appears", () => {
    const out = redactProviderSecrets("failed with key abcdef1234567890", ["abcdef1234567890"]);
    expect(out).not.toContain("abcdef1234567890");
    expect(out).toContain("[redacted]");
  });

  it("removes credential-shaped query parameters even for values KIVO does not hold", () => {
    expect(redactProviderSecrets("GET /v4/matches?api_key=zzz9zzz9&season=2026")).toContain("api_key=[redacted]");
    expect(redactProviderSecrets("GET /v4/matches?api_key=zzz9zzz9&season=2026")).toContain("season=2026");
  });

  it("removes a bearer token", () => {
    expect(redactProviderSecrets("Authorization: Bearer abcdefgh12345678")).toBe("Authorization: Bearer [redacted]");
  });

  it("leaves a short value alone rather than shredding ordinary text", () => {
    expect(redactProviderSecrets("no secrets here", ["ab"])).toBe("no secrets here");
  });
});

describe("userFacingProviderMessage", () => {
  it("never names a provider, a status, a key or anything technical", () => {
    const forbidden = /api|provider|http|\d{3}|key|token|quota|upstream|plan/i;
    const kinds: ProviderErrorKind[] = [
      "rate_limited",
      "auth",
      "plan",
      "not_found",
      "server_error",
      "client_error",
      "network_error",
      "timeout",
      "malformed_response",
      "empty_response",
      "partial_data",
    ];
    for (const kind of kinds) {
      expect(userFacingProviderMessage(kind)).not.toMatch(forbidden);
    }
  });

  it("tells a fan the same thing whether the account is suspended or the quota ran out", () => {
    // Both are operator problems. A fan told the difference learns something
    // alarming they cannot act on.
    expect(userFacingProviderMessage("auth")).toBe(userFacingProviderMessage("rate_limited"));
  });

  it("is derived on the error rather than settable, so a raw provider sentence cannot be smuggled in", () => {
    const err = new KivoProviderError("Your account is suspended, contact support", {
      provider: "bigballs",
      kind: "auth",
    });
    expect(err.userMessage).toBe("Live updates are temporarily unavailable.");
    expect(err.userMessage).not.toContain("suspended");
  });
});

describe("describeStatusFailure", () => {
  it("says a plan refusal is not a key problem, in as many words", () => {
    const message = describeStatusFailure("bigballs", 402, "plan", "/competitions", null);
    expect(message).toContain("not a key problem");
  });

  it("quotes the provider's own Retry-After when it gave one, and says so when it did not", () => {
    expect(describeStatusFailure("x", 429, "rate_limited", "/p", 30)).toContain("30s");
    expect(describeStatusFailure("x", 429, "rate_limited", "/p", null)).toContain("did not say");
  });
});

describe("requestProvider", () => {
  const base = {
    provider: "bigballs",
    path: "/matches?date=2026-08-19",
    url: "https://example.invalid/matches?date=2026-08-19",
    headers: {},
    sleepImpl: noSleep,
  };

  it("returns on a first-attempt success, with no retry and a measured latency", async () => {
    let clock = 1_000;
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(200, { "x-quota": "40" }));
    const result = await requestProvider({
      ...base,
      fetchImpl,
      quotaHeaders: ["x-quota"],
      nowImpl: () => (clock += 25),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.quotaRemaining).toBe(40);
    expect(result.attempts).toBe(1);
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it("retries a 5xx once and succeeds, sleeping exactly once in between", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(fakeResponse(503))
      .mockResolvedValueOnce(fakeResponse(200));
    const sleepImpl = vi.fn(noSleep);

    const result = await requestProvider({ ...base, fetchImpl, sleepImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledTimes(1);
    expect(result.attempts).toBe(2);
  });

  it("never retries a 429 and carries the provider's Retry-After onto the error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(429, { "retry-after": "60" }));
    const sleepImpl = vi.fn(noSleep);

    await expect(requestProvider({ ...base, fetchImpl, sleepImpl })).rejects.toMatchObject({
      kind: "rate_limited",
      status: 429,
      retryAfterSeconds: 60,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleepImpl).not.toHaveBeenCalled();
  });

  it("stops at the attempt budget rather than retrying a 5xx forever", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse(500));
    await expect(requestProvider({ ...base, fetchImpl, maxAttempts: 3 })).rejects.toMatchObject({
      kind: "server_error",
      attempts: 3,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports an aborted attempt as a timeout, not as a network error", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchImpl = vi.fn().mockRejectedValue(abortError);
    await expect(requestProvider({ ...base, fetchImpl, maxAttempts: 1 })).rejects.toMatchObject({ kind: "timeout" });
  });

  it("reports an ordinary fetch rejection as a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(requestProvider({ ...base, fetchImpl, maxAttempts: 1 })).rejects.toMatchObject({
      kind: "network_error",
    });
  });

  it("reports exactly one outcome per request, success or failure", async () => {
    const outcomes: ProviderRequestOutcome[] = [];
    const onOutcome = (outcome: ProviderRequestOutcome) => {
      outcomes.push(outcome);
    };

    await requestProvider({ ...base, fetchImpl: vi.fn().mockResolvedValue(fakeResponse(200)), onOutcome });
    await expect(
      requestProvider({ ...base, fetchImpl: vi.fn().mockResolvedValue(fakeResponse(403)), onOutcome }),
    ).rejects.toBeInstanceOf(KivoProviderError);

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]).toMatchObject({ outcome: "success", kind: null, status: 200 });
    expect(outcomes[1]).toMatchObject({ outcome: "error", kind: "auth", status: 403 });
    // Measured, not defaulted: the shape must carry a real number or a null.
    expect(outcomes[0].latencyMs).not.toBeNull();
  });

  it("keeps the key out of the error message even when the URL carries one", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed for ?api_key=supersecretvalue"));
    await expect(
      requestProvider({
        ...base,
        path: "/matches?api_key=supersecretvalue",
        fetchImpl,
        maxAttempts: 1,
        secrets: ["supersecretvalue"],
      }),
    ).rejects.toMatchObject({ message: expect.not.stringContaining("supersecretvalue") });
  });
});

describe("toKivoProviderError", () => {
  it("passes an already-normalized error through rather than re-wrapping and losing its kind", () => {
    const original = new KivoProviderError("nope", { provider: "x", kind: "plan" });
    expect(toKivoProviderError(original, "x")).toBe(original);
  });

  it("normalizes anything else, including a thrown string", () => {
    expect(toKivoProviderError("boom", "x").kind).toBe("network_error");
    expect(toKivoProviderError(new TypeError("bad parse"), "x", "malformed_response").kind).toBe("malformed_response");
  });
});
