/**
 * Fetch orchestration for the API-Football adapter (providers/api-football.ts):
 * the provider-specific half of it. The transport half — retry, exponential
 * backoff, timeout, quota-header reading, secret redaction and the error
 * taxonomy — moved to `provider-request.ts` when the second and third providers
 * arrived, and this file now delegates to it rather than carrying its own copy.
 *
 * What stays here is everything only API-Football does: answering account and
 * plan problems with HTTP 200 and a populated `errors` field, naming the season
 * range a refused plan can actually serve, and the wording an operator reads
 * when either happens. None of that generalises, because no other provider does
 * it.
 *
 * Deliberately without a "server-only" import, unchanged: this stays importable
 * from unit tests without dragging in api-football.ts's env and fetch
 * dependencies, same rationale as normalizers.ts.
 */

import {
  KivoProviderError,
  backoffDelayMs,
  classifyStatusKind,
  isRetryableKind,
  requestProvider,
  type ProviderErrorKind,
  type ProviderRequestOutcome,
} from "./provider-request";

export const API_FOOTBALL_PROVIDER_ID = "api-football";

/**
 * The header API-Football sends its remaining-quota count on. Known because
 * this adapter has been reading it in production, which is exactly why it can
 * be a single name here while `provider-request.ts` takes a list — the other
 * providers' header names are not known from this environment.
 */
export const API_FOOTBALL_QUOTA_HEADERS = ["x-ratelimit-requests-remaining"] as const;

/**
 * Now an alias of KIVO's taxonomy rather than a parallel one.
 *
 * It was `"rate_limited" | "auth" | "plan" | "server_error" | "client_error" |
 * "network_error"` — every one of which survives, in the same spelling, because
 * `ProviderErrorKind` was defined as an extension of this list rather than a
 * replacement for it. Widening it here means a 404 now classifies as
 * `not_found` instead of being flattened into `client_error`, and an abandoned
 * request as `timeout` instead of `network_error`. Both are strictly more
 * information at every call site, and no call site branches on a kind it did
 * not have before.
 */
export type ApiFootballErrorKind = ProviderErrorKind;

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

/**
 * The seasons a plan refusal says the account CAN see.
 *
 * API-Football's refusal carries the answer inside the sentence — "try from
 * 2022 to 2024" — and that range is the single most actionable fact in the
 * whole message, because it is exactly what has to go into KIVO's target
 * season. Parsed out so a surface can offer the year rather than making
 * somebody read for it. Null when the provider did not name a range; never
 * guessed, because a wrong range would send an operator to a season that is
 * also refused.
 */
export function parseSupportedSeasonRange(message: string): { from: number; to: number } | null {
  const match = /from\s+(\d{4})\s+to\s+(\d{4})/i.exec(message);
  if (!match) return null;
  const from = Number(match[1]);
  const to = Number(match[2]);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
  return { from, to };
}

/**
 * Which kind of refusal a 200-with-`errors` response actually is.
 *
 * The distinction that matters is between **the account** and **the plan**, and
 * before this function they were the same kind. A suspended or unverified
 * account is fixed by going to the provider's dashboard. A plan that does not
 * cover the season being asked for is fixed by asking for a different season,
 * which costs nothing and takes a minute — and telling somebody to check their
 * API key when the real answer is "point KIVO at 2024" costs them a day. The
 * live database recorded exactly that message under a `client_error` kind
 * before this existed.
 *
 * The provider's `errors` key is the primary signal (`plan`, `access`,
 * `token`), and the message is a secondary one for the cases where the key is
 * something generic like `season` but the sentence is unmistakably about the
 * plan.
 */
export function classifyProviderErrorKind(key: string, message: string): ApiFootballErrorKind {
  const normalizedKey = key.trim().toLowerCase();
  if (normalizedKey === "plan" || normalizedKey === "subscription") return "plan";
  // `access` is the account itself — suspended, unverified, or out of plan.
  // That is an auth problem however it is spelled, and it is the one an
  // operator can actually fix from the provider's dashboard.
  if (normalizedKey === "access" || normalizedKey === "token") return "auth";
  if (/\b(free|current)\s+plans?\b|\bupgrade\s+(your|to a)\b|\bnot\s+(available|included)\s+(in|on|with)\s+your\s+plan\b/i.test(message)) {
    return "plan";
  }
  return "client_error";
}

/**
 * Turns a plan refusal into the sentence an operator can act on, keeping the
 * provider's own words attached.
 *
 * Both halves are deliberate. The plain half is what stops a day being lost —
 * "your plan does not cover this season" is an instruction; "Free plans do not
 * have access to this season, try from 2022 to 2024" read cold at the bottom of
 * a sync-run row is a riddle about whose fault it is. The raw half is kept
 * because KIVO must never present its own paraphrase as if it were the
 * provider's statement, and because the exact wording is what makes the claim
 * checkable against the provider's support.
 */
export function describePlanRefusal(providerMessage: string, requestedPath: string): string {
  const range = parseSupportedSeasonRange(providerMessage);
  const seasonInPath = /[?&]season=(\d{4})/.exec(requestedPath)?.[1] ?? null;

  const asked = seasonInPath ? `season ${seasonInPath}` : "this request";
  const offer = range
    ? ` The provider says this plan can serve ${range.from} to ${range.to}.`
    : "";
  const fix = range
    ? ` Set KIVO's target season to a year in that range (Admin -> Data Health -> target season, or ${TARGET_SEASON_ENV_NAME}) and every season-scoped sync starts working, or upgrade the plan to reach the current season.`
    : " Set KIVO's target season to a year the plan covers (Admin -> Data Health -> target season), or upgrade the plan.";

  return (
    `Your API-Football plan does not cover ${asked}.${offer}${fix}` +
    ` The provider's own words: "${providerMessage}"`
  );
}

/** Named here rather than imported so this module keeps its deliberate lack of
 * dependencies (see the file header) — `target-season.ts` owns the variable and
 * this is only quoting its name in a sentence. */
const TARGET_SEASON_ENV_NAME = "FOOTBALL_TARGET_SEASON";

/**
 * API-Football's failures, in KIVO's shape.
 *
 * A subclass rather than a replacement, for two reasons that both matter.
 * `api-football.ts` catches `err instanceof ApiFootballError` in its request
 * wrapper, and that is load-bearing — it is how a provider refusal keeps its
 * quota reading and its raw-response sample. And every consumer of the generic
 * layer (telemetry, the Admin page, the user-facing copy) can now handle this
 * error without knowing which provider produced it, because it IS a
 * KivoProviderError.
 *
 * The constructor keeps its original positional signature so no existing call
 * site changes.
 */
export class ApiFootballError extends KivoProviderError {
  constructor(message: string, kind: ApiFootballErrorKind, status: number | null, quotaRemaining: number | null) {
    super(message, { provider: API_FOOTBALL_PROVIDER_ID, kind, status, quotaRemaining });
    this.name = "ApiFootballError";
  }
}

/**
 * Turning an HTTP status into an error kind is now `provider-request.ts`'s job,
 * and this file imports it rather than keeping a second opinion. The invariant
 * the local copy existed to protect — that the retry decision and the thrown
 * error can never disagree about what a status means — is now protected across
 * every provider rather than within this one.
 */

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
 * Unchanged in meaning, delegated in implementation: 5xx and network failures
 * are worth a retry, a 429 never is (it spends another request against a limit
 * already reached), and other 4xx will not succeed on a second try either. The
 * generic version adds `timeout` to the retryable set, which this adapter did
 * not previously have a kind for at all.
 */
export function isRetryable(kind: ApiFootballErrorKind): boolean {
  return isRetryableKind(kind);
}

const MAX_ATTEMPTS = 2; // one real attempt + exactly one retry, never more

/** Small jittered backoff so a retried request doesn't land in the exact same
 * instant as the one that just failed. Kept for the one caller that still names
 * it; new code should use `backoffDelayMs`, which grows the window on repeated
 * failure instead of holding it flat. */
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
  /** The cache policy class this request belongs to, passed straight through to
   * telemetry so `provider_request_log` can say what a request was for. */
  resourceClass?: string | null;
  /** Injectable for tests — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests — defaults to a real setTimeout-based sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Called once with what actually happened, for `provider_request_log`. */
  onOutcome?: (outcome: ProviderRequestOutcome) => void | Promise<void>;
}

export interface RequestWithRetryResult {
  response: Response;
  quotaRemaining: number | null;
}

/**
 * Performs the provider fetch, delegating everything transport-shaped to
 * `requestProvider` and re-labelling its failure as an `ApiFootballError` so
 * `api-football.ts`'s existing `instanceof` catch keeps working.
 *
 * The re-labelling is a deliberate seam rather than a leftover. The generic
 * layer produces a `KivoProviderError`, which is what the rest of the platform
 * wants; this adapter's own error carries API-Football's wording and is what
 * `sync_runs.error_message` has been showing operators for weeks. Converting at
 * the boundary keeps both, and costs one catch block.
 *
 * `MAX_ATTEMPTS` is still 2 — one real attempt plus exactly one retry, never
 * more, because every attempt is somebody's quota.
 */
export async function requestWithRetry(options: RequestWithRetryOptions): Promise<RequestWithRetryResult> {
  try {
    const result = await requestProvider({
      provider: API_FOOTBALL_PROVIDER_ID,
      path: options.path,
      url: options.url,
      headers: options.headers,
      resourceClass: options.resourceClass ?? null,
      revalidateSeconds: options.revalidateSeconds,
      maxAttempts: MAX_ATTEMPTS,
      quotaHeaders: API_FOOTBALL_QUOTA_HEADERS,
      secrets: [options.headers["x-apisports-key"]],
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      onOutcome: options.onOutcome,
    });
    return { response: result.response, quotaRemaining: result.quotaRemaining };
  } catch (err) {
    if (err instanceof KivoProviderError) {
      // The one place API-Football's own wording is reapplied on top of the
      // generic sentence: an operator reading a sync run expects to see the
      // provider named the way the rest of this adapter names it.
      throw new ApiFootballError(
        err.kind === "rate_limited"
          ? `API-Football daily quota exhausted (429) while requesting ${options.path}. Wait for the provider's quota reset before syncing again.`
          : err.kind === "auth"
            ? `API-Football rejected the request (${err.status ?? "no status"}) while requesting ${options.path}. Check that API_FOOTBALL_KEY is set and valid.`
            : err.message,
        err.kind,
        err.status,
        err.quotaRemaining,
      );
    }
    throw err;
  }
}

/** Retained so `backoffDelayMs` has a named import in this module and the
 * relationship between the two backoff shapes stays visible to a reader who
 * lands here first. */
export { backoffDelayMs };
