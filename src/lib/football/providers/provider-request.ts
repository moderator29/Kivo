/**
 * The transport every football provider shares.
 *
 * This is `api-football-request.ts` generalised rather than copied. That module
 * had the right ideas — classify the response before believing it, retry only
 * what a retry can fix, read the quota the provider volunteers, and never let a
 * provider's own sentence reach a fan — but all four were expressed in
 * API-Football's vocabulary. With three providers those ideas have to be said
 * once, in a vocabulary none of them owns, or the third adapter re-derives them
 * slightly differently and the product ends up with three opinions about what a
 * 429 means.
 *
 * Deliberately WITHOUT `import "server-only"`, exactly like the module it
 * generalises: this has to stay importable from unit tests without dragging in
 * the adapters' env and fetch dependencies.
 *
 * What is NOT here, on purpose: anything that knows a provider's URL shape,
 * parameter names, or response schema. Those belong to each adapter. This file
 * knows about HTTP, time, and how KIVO talks about failure.
 */

/**
 * KIVO's own failure taxonomy — the one every adapter normalizes into.
 *
 * It extends the shape `api-football-request.ts` already had (`rate_limited`,
 * `auth`, `plan`, `server_error`, `client_error`, `network_error`) rather than
 * inventing a parallel one, and adds the five cases the founder's brief names
 * that the original could not express:
 *
 *   not_found           the resource genuinely is not there (404). Distinct from
 *                       an empty response, because "this fixture does not exist"
 *                       and "this fixture exists and has no events yet" lead to
 *                       different product behaviour.
 *   timeout             the provider never answered. Distinct from a network
 *                       error because it is the one failure where the request
 *                       may well have been served — and possibly counted
 *                       against the quota — with only the answer lost.
 *   malformed_response  a 200 whose body is not what the contract says. Almost
 *                       always a provider-side change, and the single most
 *                       dangerous failure to swallow, because unlike a 500 it
 *                       looks like success all the way to the database.
 *   empty_response      a well-formed answer containing nothing. Named, not
 *                       thrown by default: for most resources it is a legitimate
 *                       answer ("no matches today") and only the caller knows
 *                       whether it is legitimate for its own resource.
 *   partial_data        some of what was asked for arrived. Worth writing and
 *                       worth flagging, which is why it is a kind rather than
 *                       an error/success boolean.
 */
export type ProviderErrorKind =
  | "rate_limited"
  | "auth"
  | "plan"
  | "not_found"
  | "server_error"
  | "client_error"
  | "network_error"
  | "timeout"
  | "malformed_response"
  | "empty_response"
  | "partial_data";

/**
 * The normalized error every provider failure becomes before it leaves the
 * transport.
 *
 * Two audiences, two fields, and the separation between them is the whole
 * point. `message` is for an operator and may be as specific as it likes — it
 * is what lands in `sync_runs.error_message` and in `provider_request_log`, and
 * an operator who cannot tell a suspended account from an exhausted quota
 * cannot fix either. `userMessage` is what a fan may see, and it is football or
 * it is nothing: no status code, no provider name, no key, no "upstream".
 *
 * Nothing constructs one of these with a raw provider sentence in
 * `userMessage`. There is no constructor parameter for it — it is derived from
 * the kind, so the leak cannot be introduced by a caller in a hurry.
 */
export class KivoProviderError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  /** The provider's own remaining-quota count if the response carried one. A
   * network error or a timeout never does — null, never zero. */
  readonly quotaRemaining: number | null;
  /** Seconds the provider asked us to wait, from `Retry-After`, when it said
   * so. Null means it did not say, which is not the same as "wait zero". */
  readonly retryAfterSeconds: number | null;
  /** How many attempts were actually made, including the first. */
  readonly attempts: number;
  /** Measured round-trip milliseconds for the last attempt, or null when there
   * was nothing to measure. Never 0 as a stand-in for unknown. */
  readonly latencyMs: number | null;

  constructor(
    message: string,
    init: {
      provider: string;
      kind: ProviderErrorKind;
      status?: number | null;
      quotaRemaining?: number | null;
      retryAfterSeconds?: number | null;
      attempts?: number;
      latencyMs?: number | null;
    },
  ) {
    super(message);
    this.name = "KivoProviderError";
    this.provider = init.provider;
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.quotaRemaining = init.quotaRemaining ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
    this.attempts = init.attempts ?? 1;
    this.latencyMs = init.latencyMs ?? null;
  }

  /** What a fan is allowed to be told. Derived, never supplied. */
  get userMessage(): string {
    return userFacingProviderMessage(this.kind);
  }
}

/**
 * The sentences the product is allowed to say when football data does not
 * arrive.
 *
 * Every one of them is about football or about waiting. None of them contains a
 * status code, a provider name, the word "API", the word "upstream", or any
 * hint that KIVO buys its football from somebody. A fan reading these learns
 * exactly one true thing — that this will probably be here shortly — which is
 * the only thing that is any of their business and the only thing they can act
 * on.
 *
 * The diagnosis is not lost. It is in Admin, where somebody can do something
 * about it.
 */
export function userFacingProviderMessage(kind: ProviderErrorKind): string {
  switch (kind) {
    case "not_found":
      return "We don't have this one yet.";
    case "empty_response":
      return "Nothing to show here yet.";
    case "partial_data":
      return "Some of this hasn't come through yet.";
    case "timeout":
    case "network_error":
    case "server_error":
      return "Live updates are temporarily unavailable.";
    // Auth, plan, quota and malformed responses are all operator problems, and
    // a fan told the difference would only be told something alarming they
    // cannot act on. They read as the same brief pause as everything else.
    default:
      return "Live updates are temporarily unavailable.";
  }
}

/**
 * Maps an HTTP status onto a kind. One function so the retry decision and the
 * thrown error can never disagree about what a status means — the invariant
 * `api-football-request.ts` established and the reason it had a single
 * `classifyStatusKind`.
 *
 * 402 is `plan` because that is literally what Payment Required means, and the
 * `plan` kind is the whole reason an operator does not waste a day checking a
 * key that was never the problem. 401 and 403 are both `auth`: from KIVO's side
 * "you are not who you say" and "you may not have this" are fixed in the same
 * place, the provider's dashboard.
 */
export function classifyStatusKind(status: number): ProviderErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "plan";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server_error";
  return "client_error";
}

/**
 * Only failures a second attempt could plausibly fix.
 *
 * A 429 is deliberately NOT retryable, and that is the rule most likely to be
 * "improved" by somebody who has just read about `Retry-After`. Retrying a rate
 * limit spends another request against a limit that has already been reached —
 * on a hundred-a-day tier that is not politeness, it is the difference between
 * a slow hour and a dead day. The right response to a 429 is to stop and to
 * record `retryAfterSeconds` so the scheduler knows when to come back, which is
 * what `requestProvider` does.
 *
 * A timeout IS retryable, but note what that means: the first request may have
 * been served and counted. That is accepted, because the alternative — never
 * retrying a timeout — turns one dropped packet into a missing match.
 */
export function isRetryableKind(kind: ProviderErrorKind): boolean {
  return kind === "server_error" || kind === "network_error" || kind === "timeout";
}

/**
 * Exponential backoff with full jitter.
 *
 * Exponential because a provider that just returned a 500 is often mid-incident
 * and a fixed 250ms retry arrives while it is still on fire. Full jitter (a
 * uniform draw across the whole window, not the window plus a small wobble)
 * because the alternative synchronises every retrying caller onto the same
 * instant — the thundering herd that turns one provider blip into a
 * self-inflicted second one. This is the AWS "full jitter" shape and it is
 * chosen over "equal jitter" because KIVO's retry counts are tiny, so spread
 * matters more than a guaranteed minimum wait.
 *
 * Deterministic in `random` so the test suite can assert the window rather than
 * the draw.
 */
export function backoffDelayMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const baseMs = options.baseMs ?? 250;
  const maxMs = options.maxMs ?? 8_000;
  const random = options.random ?? Math.random;
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * exponential);
}

/**
 * `Retry-After`, in either of the two forms RFC 9110 permits: a count of
 * seconds, or an HTTP date.
 *
 * Read defensively and clamped at zero — a provider whose clock is ahead of
 * ours would otherwise produce a negative wait, which a scheduler would read as
 * "go now" at exactly the moment it must not.
 */
export function parseRetryAfterSeconds(headerValue: string | null, now: number = Date.now()): number | null {
  if (headerValue === null) return null;
  const trimmed = headerValue.trim();
  if (trimmed.length === 0) return null;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return Math.max(0, Math.floor(asNumber));

  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return null;
  return Math.max(0, Math.ceil((asDate - now) / 1000));
}

/**
 * The remaining-quota count, from whichever header this provider happens to
 * use.
 *
 * A LIST of candidate header names rather than one, and this is the honest part
 * rather than a hedge: API-Football's header name is known because its adapter
 * has been reading it for weeks. **The two new providers' header names are not
 * known** — their domains are blocked by the egress proxy this was built
 * behind, so neither their documentation nor a live response header could be
 * read. Guessing a single name and hard-coding it would produce a permanent,
 * silent null that looks exactly like "the provider does not report quota".
 *
 * So each adapter passes the names it has reason to believe in, the first
 * present and numeric one wins, and an absent set degrades to null — which the
 * Admin page renders as "not reported", not as zero.
 */
export function parseQuotaRemaining(headers: Headers, candidateNames: readonly string[]): number | null {
  for (const name of candidateNames) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Removes anything credential-shaped from text that is about to be stored or
 * logged.
 *
 * Belt and braces, and both are deserved. The braces: no code path
 * intentionally puts a key into a message. The belt: provider error bodies
 * routinely echo the request back, query strings sometimes carry tokens, and a
 * key that reaches `provider_request_log` is a key at rest in a table an admin
 * page reads. This runs before the insert rather than on the way out, so there
 * is no window in which the secret exists in the database.
 *
 * `secrets` are the literal values the caller holds. The patterns catch the
 * shapes — `key=…`, `token=…`, `Bearer …` — that a value KIVO does not hold
 * could still arrive in.
 */
export function redactProviderSecrets(text: string, secrets: readonly (string | undefined | null)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("[redacted]");
    }
  }
  out = out.replace(/\b(api[-_]?key|apikey|key|token|auth|authorization|secret)=([^&\s"']+)/gi, "$1=[redacted]");
  out = out.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, "Bearer [redacted]");
  return out;
}

/** What one attempt is reported as, whether it succeeded or not. Handed to the
 * telemetry sink so `provider_request_log` is written from measurements rather
 * than from guesses. */
export interface ProviderRequestOutcome {
  provider: string;
  resourceClass: string | null;
  outcome: "success" | "error";
  kind: ProviderErrorKind | null;
  status: number | null;
  /** Null when nothing measured it. Never 0 as a stand-in. */
  latencyMs: number | null;
  quotaRemaining: number | null;
  attempts: number;
  message: string | null;
}

export interface ProviderRequestOptions {
  /** Canonical provider id — the same string the request budget and the
   * telemetry log are keyed by. */
  provider: string;
  /** Path only, for messages. Never the full URL: a URL can carry a key. */
  path: string;
  url: string;
  headers: Record<string, string>;
  /** The policy class this request is being made under, for telemetry. Null for
   * a transport probe that belongs to no class. */
  resourceClass?: string | null;
  /** Next's own per-fetch cache window. Kept alongside the database cache
   * rather than replaced by it: this one is free and deduplicates within an
   * instance, the database one deduplicates across instances. */
  revalidateSeconds?: number;
  /** Total attempts including the first. Two by default — the value
   * `api-football-request.ts` chose and defended: one real attempt plus exactly
   * one retry, never more, because every attempt is somebody's quota. */
  maxAttempts?: number;
  /** How long one attempt may take before it is abandoned as a timeout. A
   * provider that never answers must not hold a serverless invocation open
   * until the platform kills it, because a killed invocation writes no
   * telemetry and leaves a lease dangling. */
  timeoutMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Header names that may carry a remaining-quota count, in preference order.
   * See parseQuotaRemaining for why this is a list. */
  quotaHeaders?: readonly string[];
  /** Literal secret values to scrub from any message this produces. */
  secrets?: readonly (string | undefined | null)[];
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  randomImpl?: () => number;
  /** Called exactly once per request with what actually happened. Failures in
   * the sink are swallowed by the caller's own implementation — telemetry must
   * never be the reason a football request fails. */
  onOutcome?: (outcome: ProviderRequestOutcome) => void | Promise<void>;
}

export interface ProviderRequestResult {
  response: Response;
  quotaRemaining: number | null;
  latencyMs: number;
  attempts: number;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * One provider request, with the retry, backoff, timeout, quota reading and
 * telemetry that every adapter would otherwise write for itself.
 *
 * Throws `KivoProviderError` for every failure, including the ones that arrive
 * as a perfectly valid HTTP response. Returns the raw `Response` on success —
 * parsing the body is the adapter's job, because only the adapter knows what a
 * malformed body looks like for the endpoint it asked.
 */
export async function requestProvider(options: ProviderRequestOptions): Promise<ProviderRequestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const nowImpl = options.nowImpl ?? Date.now;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const quotaHeaders = options.quotaHeaders ?? [];

  const scrub = (text: string) => redactProviderSecrets(text, options.secrets ?? []);

  const report = async (outcome: ProviderRequestOutcome) => {
    if (!options.onOutcome) return;
    await options.onOutcome(outcome);
  };

  let attempts = 0;
  let lastError: KivoProviderError | null = null;

  while (attempts < maxAttempts) {
    if (attempts > 0) {
      await sleepImpl(
        backoffDelayMs(attempts, {
          baseMs: options.backoffBaseMs,
          maxMs: options.backoffMaxMs,
          random: options.randomImpl,
        }),
      );
    }
    attempts += 1;

    const startedAt = nowImpl();
    // AbortController rather than AbortSignal.timeout so the timer is a plain
    // setTimeout the test suite can control, and so it can be cleared the
    // instant the response lands rather than being left to fire into nothing.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        headers: options.headers,
        signal: controller.signal,
        ...(options.revalidateSeconds === undefined
          ? {}
          : { next: { revalidate: options.revalidateSeconds } }),
      } as RequestInit);
    } catch (err) {
      const latencyMs = nowImpl() - startedAt;
      // An abort is our own timeout, not the provider's network failing. The
      // two are different facts: one means "it never answered in the time we
      // allow", the other means "we could not reach it at all", and only the
      // first implies the request may have been served and charged.
      const aborted = controller.signal.aborted || (err instanceof Error && err.name === "AbortError");
      const kind: ProviderErrorKind = aborted ? "timeout" : "network_error";
      const detail = err instanceof Error ? err.message : String(err);
      lastError = new KivoProviderError(
        scrub(
          aborted
            ? `${options.provider} did not answer within ${timeoutMs}ms while requesting ${options.path}.`
            : `${options.provider} could not be reached while requesting ${options.path} (${detail}).`,
        ),
        { provider: options.provider, kind, status: null, attempts, latencyMs },
      );
      if (isRetryableKind(kind) && attempts < maxAttempts) continue;
      break;
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = nowImpl() - startedAt;
    const quotaRemaining = parseQuotaRemaining(response.headers, quotaHeaders);

    if (response.ok) {
      await report({
        provider: options.provider,
        resourceClass: options.resourceClass ?? null,
        outcome: "success",
        kind: null,
        status: response.status,
        latencyMs,
        quotaRemaining,
        attempts,
        message: null,
      });
      return { response, quotaRemaining, latencyMs, attempts };
    }

    const kind = classifyStatusKind(response.status);
    const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"), nowImpl());
    lastError = new KivoProviderError(
      scrub(describeStatusFailure(options.provider, response.status, kind, options.path, retryAfterSeconds)),
      { provider: options.provider, kind, status: response.status, quotaRemaining, retryAfterSeconds, attempts, latencyMs },
    );

    if (isRetryableKind(kind) && attempts < maxAttempts) continue;
    break;
  }

  // Unreachable with maxAttempts >= 1, but the compiler cannot know that and a
  // thrown null would be the worst possible way to find out.
  const error =
    lastError ??
    new KivoProviderError(`${options.provider} request failed before any attempt was made (${options.path}).`, {
      provider: options.provider,
      kind: "network_error",
      attempts,
    });

  await report({
    provider: options.provider,
    resourceClass: options.resourceClass ?? null,
    outcome: "error",
    kind: error.kind,
    status: error.status,
    latencyMs: error.latencyMs,
    quotaRemaining: error.quotaRemaining,
    attempts: error.attempts,
    message: error.message,
  });

  throw error;
}

/**
 * The operator-facing sentence for a non-OK status.
 *
 * Says what happened AND what to do about it, in that order, because the one
 * lesson `describePlanRefusal` paid for is that a technically accurate message
 * with no instruction in it costs somebody a day. Never carries the provider's
 * own body — that is scrubbed and attached by the adapter, which is the only
 * layer that knows whether the body is safe to quote.
 */
export function describeStatusFailure(
  provider: string,
  status: number,
  kind: ProviderErrorKind,
  path: string,
  retryAfterSeconds: number | null,
): string {
  switch (kind) {
    case "rate_limited": {
      const when =
        retryAfterSeconds === null
          ? "The provider did not say when the limit resets."
          : `The provider asked for ${retryAfterSeconds}s before the next request.`;
      return `${provider} refused the request as rate limited (429) at ${path}. ${when} KIVO does not retry a rate limit — retrying spends another request against a limit already reached.`;
    }
    case "auth":
      return `${provider} rejected the credentials (${status}) at ${path}. Check that this provider's key is set in the deployment and still valid in the provider's dashboard.`;
    case "plan":
      return `${provider} says this request is not covered by the current plan (${status}) at ${path}. This is not a key problem — the key worked; the plan does not reach this resource.`;
    case "not_found":
      return `${provider} has no such resource (404) at ${path}. If KIVO expected one, the id mapping for it is wrong rather than the provider being down.`;
    case "timeout":
      return `${provider} timed out server-side (${status}) at ${path}.`;
    case "server_error":
      return `${provider} failed on its own side (${status}) at ${path}. Retried where the attempt budget allowed.`;
    default:
      return `${provider} refused the request (${status}) at ${path}.`;
  }
}

/**
 * Turns anything thrown into a normalized KIVO error.
 *
 * The catch-all every caller boundary needs, so a `TypeError` from a bad parse
 * or a string thrown by a dependency cannot reach a page as an unhandled crash.
 * An already-normalized error passes through unchanged rather than being
 * re-wrapped and losing its kind.
 */
export function toKivoProviderError(
  err: unknown,
  provider: string,
  fallbackKind: ProviderErrorKind = "network_error",
): KivoProviderError {
  if (err instanceof KivoProviderError) return err;
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown provider failure.";
  return new KivoProviderError(redactProviderSecrets(message), { provider, kind: fallbackKind });
}
