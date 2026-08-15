/**
 * Fetch orchestration for the TheSportsDB adapter (providers/thesportsdb.ts).
 * Deliberately mirrors ./api-football-request.ts's classify/retry/backoff shape
 * exactly (RECOMMENDATIONS.md items 53-55, and the founder's 2026-08-15
 * directive: "follow the existing api-football-request.ts pattern... don't
 * invent a different retry policy") — one jittered retry for a network error
 * or 5xx only, never for a 429 or other 4xx. `retryDelayMs` is imported
 * directly from that module rather than re-implemented, so the two providers'
 * backoff timing can never drift apart.
 *
 * What's genuinely different from API-Football and can't just be reused:
 * TheSportsDB's v1 API does not document (and, per every third-party source
 * cross-checked for this adapter — see thesportsdb.ts's top doc comment) does
 * not appear to send any `x-ratelimit-*`-style response header at all. There
 * is nothing here for parseQuotaRemaining to parse, so TheSportsDbProvider's
 * getQuotaRemaining() always returns null — not an estimate, not a guess,
 * genuinely "this provider doesn't report one" (same convention
 * FootballDataProvider.getQuotaRemaining()'s doc comment already allows for).
 * Auth also differs: the key is a URL path segment
 * (/api/v1/json/{key}/endpoint.php), not a header, so there's no header to
 * redact/attach here — the caller builds the full URL itself.
 *
 * Split into its own module — deliberately without a "server-only" import —
 * for the same reason as api-football-request.ts: importable from unit tests
 * without dragging in thesportsdb.ts's server-only fetch/env dependencies.
 */
import { retryDelayMs } from "./api-football-request";

export type TheSportsDbErrorKind = "rate_limited" | "auth" | "server_error" | "client_error" | "network_error";

export class TheSportsDbError extends Error {
  readonly status: number | null;
  readonly kind: TheSportsDbErrorKind;

  constructor(message: string, kind: TheSportsDbErrorKind, status: number | null) {
    super(message);
    this.name = "TheSportsDbError";
    this.kind = kind;
    this.status = status;
  }
}

/** Same status-code buckets as api-football-request.ts's classifyStatusKind,
 * kept as a separate function (rather than imported) because the two
 * providers' error *messages* below deliberately differ — a shared bucketing
 * function with provider-specific message text at the call site would be a
 * false economy for two dozen lines of code. The bucketing rule itself
 * (429/403-ish/5xx/other-4xx) is identical on purpose. */
function classifyStatusKind(status: number): TheSportsDbErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "server_error";
  return "client_error";
}

export function classifyHttpError(status: number, path: string): TheSportsDbError {
  const kind = classifyStatusKind(status);
  if (kind === "rate_limited") {
    return new TheSportsDbError(
      `TheSportsDB rate limit hit (429) while requesting ${path}. The free tier's documented limit is 30 requests/minute — wait before retrying.`,
      kind,
      status,
    );
  }
  if (kind === "auth") {
    return new TheSportsDbError(
      `TheSportsDB rejected the request (${status}) while requesting ${path}. Check that THE_SPORTS_DB_API_KEY is set and valid.`,
      kind,
      status,
    );
  }
  return new TheSportsDbError(`TheSportsDB request failed (${status}): ${path}`, kind, status);
}

/** Identical rule to api-football-request.ts's isRetryable: only a network
 * failure or 5xx is worth a retry. A 429 must never be retried (burns more of
 * the free tier's per-minute budget); other 4xx (bad key, bad params) won't
 * succeed on a second try either. */
export function isRetryable(kind: TheSportsDbErrorKind): boolean {
  return kind === "server_error" || kind === "network_error";
}

const MAX_ATTEMPTS = 2; // one real attempt + exactly one retry, never more — matches api-football-request.ts

export interface RequestWithRetryOptions {
  /** Path only, used for error messages (e.g. "/eventsday.php?d=2026-08-15"). */
  path: string;
  url: string;
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests — defaults to a real setTimeout-based sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Performs the TheSportsDB fetch with at most one retry, only for a network
 * error or a 5xx response — a 429 or any other 4xx throws on the first
 * attempt. No headers are attached (the key already lives in `url`'s path),
 * and no quota is returned (see this file's top doc comment) — the caller
 * gets back only the parsed JSON body.
 */
export async function requestWithRetry<T>(options: RequestWithRetryOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let response: Response | null = null;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleepImpl(retryDelayMs());

    try {
      response = await fetchImpl(options.url);
      lastNetworkError = null;
    } catch (err) {
      lastNetworkError = err;
      response = null;
      continue; // network error is always retryable — loop condition caps it at one retry
    }

    if (response.ok) break;
    if (!isRetryable(classifyStatusKind(response.status))) break; // 429/401/403/other 4xx: no retry
    // else a 5xx: fall through and retry, capped by the loop condition
  }

  if (!response) {
    const message = lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError);
    throw new TheSportsDbError(
      `TheSportsDB request failed: network error while requesting ${options.path} (${message})`,
      "network_error",
      null,
    );
  }

  if (!response.ok) {
    throw classifyHttpError(response.status, options.path);
  }

  return (await response.json()) as T;
}
