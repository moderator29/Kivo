/**
 * Fetch orchestration for the API-Football adapter (providers/api-football.ts):
 * response classification (RECOMMENDATIONS.md item 54 — 429 vs 403 vs other
 * 4xx/5xx), one jittered retry for transient failures only (item 55), and the
 * quota-remaining header parse (item 53). Split into its own module —
 * deliberately without a "server-only" import — so this stays importable from
 * unit tests without dragging in api-football.ts's server-only fetch/env
 * dependencies, same rationale as normalizers.ts.
 */

export type ApiFootballErrorKind = "rate_limited" | "auth" | "server_error" | "client_error" | "network_error";

/**
 * API-Football reports account-level and parameter-level problems with HTTP
 * **200** and a populated `errors` field, not with a 4xx. A suspended account,
 * an unverified signup, a plan that does not cover an endpoint and a malformed
 * parameter all arrive looking like a perfectly successful request that simply
 * found nothing:
 *
 *     {"get":"fixtures","errors":{"access":"Your account is suspended, …"},
 *      "results":0,"response":[]}
 *
 * Reading only `response` therefore turns "the provider refused us" into "there
 * is no football today" — which is the single most expensive confusion this
 * product can make, because both render as an empty database and only one of
 * them is something the founder can act on. It cost a real afternoon before
 * this function existed.
 *
 * `errors` is `[]` on a genuinely successful call and an object with at least
 * one key when something is wrong, so emptiness is the test. Read defensively:
 * this is a parsed network payload and nothing about its shape is guaranteed.
 */
export function extractProviderError(json: unknown): { key: string; message: string } | null {
  if (!json || typeof json !== "object") return null;
  const errors = (json as { errors?: unknown }).errors;
  if (!errors || typeof errors !== "object") return null;

  const entries = Array.isArray(errors)
    ? errors.map((value, index) => [String(index), value] as const)
    : Object.entries(errors as Record<string, unknown>);

  for (const [key, value] of entries) {
    if (typeof value === "string" && value.trim().length > 0) {
      return { key, message: value.trim() };
    }
  }
  return null;
}

export class ApiFootballError extends Error {
  readonly status: number | null;
  readonly kind: ApiFootballErrorKind;
  /** The provider's own remaining-quota count, if a response was received at
   * all (a network error never carries one). */
  readonly quotaRemaining: number | null;

  constructor(message: string, kind: ApiFootballErrorKind, status: number | null, quotaRemaining: number | null) {
    super(message);
    this.name = "ApiFootballError";
    this.kind = kind;
    this.status = status;
    this.quotaRemaining = quotaRemaining;
  }
}

/** Single source of truth for turning an HTTP status into an error kind —
 * shared by classifyHttpError (the thrown error's message/kind) and
 * requestWithRetry (the retry decision), so the two can never disagree about
 * what a given status means. */
function classifyStatusKind(status: number): ApiFootballErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 403) return "auth";
  if (status >= 500) return "server_error";
  return "client_error";
}

/**
 * Classifies a non-OK HTTP response so an admin sees an accurate reason
 * instead of one generic "API-Football request failed" message for every
 * status code (RECOMMENDATIONS item 54).
 */
export function classifyHttpError(status: number, path: string, quotaRemaining: number | null): ApiFootballError {
  const kind = classifyStatusKind(status);
  if (kind === "rate_limited") {
    return new ApiFootballError(
      `API-Football daily quota exhausted (429) while requesting ${path}. Wait for the provider's quota reset before syncing again.`,
      kind,
      status,
      quotaRemaining,
    );
  }
  if (kind === "auth") {
    return new ApiFootballError(
      `API-Football rejected the request (403) while requesting ${path}. Check that API_FOOTBALL_KEY is set and valid.`,
      kind,
      status,
      quotaRemaining,
    );
  }
  return new ApiFootballError(`API-Football request failed (${status}): ${path}`, kind, status, quotaRemaining);
}

/**
 * Only 5xx and network failures are worth a retry (RECOMMENDATIONS item 55).
 * A 429 must never be retried — that just burns more quota against an
 * already-exhausted daily limit. Other 4xx (bad key, bad params) won't
 * succeed on a second try either, so they're not retried.
 */
export function isRetryable(kind: ApiFootballErrorKind): boolean {
  return kind === "server_error" || kind === "network_error";
}

const MAX_ATTEMPTS = 2; // one real attempt + exactly one retry, never more

/** Small jittered backoff so a retried request doesn't land in the exact same
 * instant as the one that just failed. */
export function retryDelayMs(baseMs = 250, jitterMs = 250): number {
  return baseMs + Math.floor(Math.random() * jitterMs);
}

/**
 * API-Football sends its own remaining-quota count on every response via
 * `x-ratelimit-requests-remaining` (RECOMMENDATIONS item 53) — parsed
 * defensively since a missing or non-numeric header should degrade to
 * "unknown" (null), never a crash.
 */
export function parseQuotaRemaining(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  const parsed = Number(headerValue);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface RequestWithRetryOptions {
  /** Path only, used for error messages (e.g. "/fixtures?date=2026-08-15"). */
  path: string;
  url: string;
  headers: Record<string, string>;
  revalidateSeconds: number;
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests — defaults to a real setTimeout-based sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface RequestWithRetryResult {
  response: Response;
  quotaRemaining: number | null;
}

/**
 * Performs the provider fetch with at most one retry, only for a network
 * error or a 5xx response (RECOMMENDATIONS item 55) — a 429 or any other 4xx
 * returns/throws on the first attempt. Throws ApiFootballError for a final
 * non-OK response so callers can distinguish rate-limited/auth/other (item 54).
 */
export async function requestWithRetry(options: RequestWithRetryOptions): Promise<RequestWithRetryResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let response: Response | null = null;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleepImpl(retryDelayMs());

    try {
      response = await fetchImpl(options.url, {
        headers: options.headers,
        next: { revalidate: options.revalidateSeconds },
      });
      lastNetworkError = null;
    } catch (err) {
      lastNetworkError = err;
      response = null;
      continue; // network error is always retryable — loop condition caps it at one retry
    }

    if (response.ok) break;
    if (!isRetryable(classifyStatusKind(response.status))) break; // 429/403/other 4xx: no retry
    // else a 5xx: fall through and retry, capped by the loop condition
  }

  if (!response) {
    const message = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError);
    throw new ApiFootballError(
      `API-Football request failed: network error while requesting ${options.path} (${message})`,
      "network_error",
      null,
      null,
    );
  }

  const quotaRemaining = parseQuotaRemaining(response.headers.get("x-ratelimit-requests-remaining"));

  if (!response.ok) {
    throw classifyHttpError(response.status, options.path, quotaRemaining);
  }

  return { response, quotaRemaining };
}
