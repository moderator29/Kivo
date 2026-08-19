import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;

/**
 * The provider request budget (`provider_request_spend`, migration 0091).
 *
 * ## Why this exists
 *
 * Before it, nothing in KIVO bounded how much provider quota automation could
 * spend. The live worker's quota floor only refuses once the provider's own
 * remaining count is at or below ten, and that count is `null` until some
 * request has recorded one — so on a fresh day, the exact window in which a
 * once-a-minute worker is most likely to run away is the window in which the
 * guard is asleep. Roughly ninety requests in ninety minutes, and then the
 * product has no data at all for the rest of the day, including the daily
 * fixture sync. A stale score is bad; no data is worse.
 *
 * ## Separate allowances, not one pool with a floor
 *
 * A reserve expressed as "stop when the shared pool gets low" fails the moment
 * anything else spends unexpectedly. Each automated consumer has its own
 * independent allowance, so the daily baseline's slice is unreachable by the
 * live worker **by construction** rather than by politeness.
 *
 * Most admin-triggered syncs consume nothing and have no bucket. The headroom
 * left outside every allowance below is what guarantees a human debugging with
 * "Sync now" always has room — and the only way to guarantee that is for
 * automation to be structurally unable to reach it.
 *
 * The one exception is `catalogue` (migration 0107), which bounds an
 * admin-triggered path. It is an exception because it is the only button whose
 * cost is one request PER CLUB rather than one request, and whose whole purpose
 * is to be pressed again tomorrow — so "a human is watching" stops being a
 * bound. See PROVIDER_REQUEST_BUDGETS below.
 */

/**
 * A rolling 24 hours, not a calendar day.
 *
 * KIVO cannot establish when API-Football's own daily counter resets: this
 * build environment has no route to api-football.com, and the only quota signal
 * the adapter reads is `x-ratelimit-requests-remaining`, which is a count and
 * not a reset time. A trailing-window cap of N implies at most N spends in ANY
 * 24-hour interval — including whatever calendar day the provider actually
 * uses — so it is conservative under every possible reset. Assuming UTC
 * midnight and being wrong in the generous direction would mean the budget
 * silently did not exist for part of every day.
 */
export const REQUEST_BUDGET_WINDOW_SECONDS = 86_400;

export type RequestBucket = "live" | "auto" | "daily" | "catalogue";

/**
 * The provider ids the database has budget rows for.
 *
 * Since migration 0118 an unrecognised provider id is refused every request
 * with `refusalReason: "unknown_provider"` — fail-closed, so a typo cannot buy
 * itself an allowance. That strictness has a cost worth naming here rather than
 * discovering in production: **an adapter that names itself something not in
 * this list, and not in `normalize_provider_id()`'s alias table, cannot make a
 * single request.** The alias table accepts the plausible spellings of each
 * (`bbs`, `bigballsdata`, `football-data-org`, …), and this constant is the
 * canonical set.
 *
 * Exported so a new adapter has one place to check itself against, and so the
 * Admin provider page can say "this provider has no budget row" instead of
 * drawing an exhausted allowance.
 */
export const BUDGETED_PROVIDER_IDS = ["api-football", "thesportsdb", "bigballs", "football-data"] as const;

export type BudgetedProviderId = (typeof BUDGETED_PROVIDER_IDS)[number];

/**
 * The allowances, against API-Football's free tier of ~100 requests/day
 * (`docs/API_FOOTBALL.md`).
 *
 *   live       55  the once-a-minute worker, paced across the day's live football
 *   auto       20  on-demand freshness on page view (`auto-sync.ts`)
 *   daily       8  the baseline: 1 fixtures call + up to 5 standings + headroom
 *   catalogue  12  the club directory and squad backfill (migration 0107)
 *                  ────
 *                  95 budgeted, leaving ~5 that NO bucket can reach.
 *
 * `catalogue` is the odd one out and migration 0107 explains it at length. The
 * short version: every other bucket here bounds AUTOMATION, and admin actions
 * were deliberately left unbudgeted because a human pressing a one-request
 * button is supervised. A squad backfill is not one request — it is one per
 * club, pressed repeatedly on purpose — so leaving it outside every allowance
 * would let a supervised human empty the day's quota and take tomorrow's
 * fixture sync with it. It is also the only bucket that goes quiet: the others
 * spend for as long as KIVO runs, while the catalogue has a finite amount of
 * work and stops asking once the directory is built.
 *
 * `auto` deserves its own note. `auto-sync.ts` bounds itself with a three-minute
 * cooldown between attempts and nothing else, which permits up to 480 requests
 * a day — nearly five times the entire tier. Unlike the live worker it fires
 * from ordinary page views rather than from a flag somebody has to turn on, so
 * it is not hypothetical: it is the bound that does not exist today.
 *
 * ## These numbers are a MIRROR, not the ceiling
 *
 * The authoritative limits live in `provider_request_limit()` (migration 0091),
 * where the only way to change one is a migration. An earlier draft passed the
 * limit as an argument to the consume, which is check-then-act one level up: a
 * caller that supplies its own ceiling decides its own ceiling, and a budget a
 * caller can raise is not a budget.
 *
 * What is here is used only for DISPLAY and for pacing arithmetic before a
 * spend is attempted. Every actual reservation reads its ceiling from the
 * database and reports it back, so a drift between these numbers and the real
 * ones can make a Data Health figure look wrong — it can never let a request
 * through that the database would have refused.
 *
 * ## Since migration 0118 the real ceilings are keyed on (provider, bucket)
 *
 * This mirror is not, and cannot honestly be, because it is a single record.
 * Today every budgeted provider carries the same four numbers, so the mirror is
 * still accurate for all of them — see `provider_request_limit(text, text)`,
 * where the rows are written out per provider precisely so they can diverge
 * later without this file being the thing that has to notice.
 *
 * When they do diverge, this constant becomes the API-Football row and every
 * display that reads it needs the provider passed in. The decision to leave it
 * as a flat record until that day is deliberate: a per-provider mirror that is
 * identical four times over is four times the drift surface for no information.
 */
export const PROVIDER_REQUEST_BUDGETS: Record<RequestBucket, number> = {
  live: 55,
  auto: 20,
  daily: 8,
  catalogue: 12,
};

export type BudgetDecision = {
  /** False means the caller MUST NOT make the provider request. Not "log a
   * warning and call anyway" — the reservation and the permission are the same
   * act, so proceeding after a refusal spends quota the ledger does not know
   * about, which is the same as having no ledger. */
  allowed: boolean;
  spentInWindow: number;
  limit: number;
  windowSeconds: number;
  /** When the oldest spend still inside the window falls out of it — the exact
   * moment an exhausted allowance frees up. */
  oldestSpendAt: string | null;
  /**
   * Requests spent by THIS provider across ALL buckets in the last 60 seconds,
   * and the ceiling on that (migration 0118).
   *
   * A second dimension, because the rolling-24h ledger is structurally blind to
   * a burst: twelve requests spread across a day and twelve fired in ninety
   * seconds are identical to it, and only one of them gets a 429. Counted across
   * every bucket because a provider's per-minute limit is not divided into
   * KIVO's consumers.
   *
   * `burstLimit === 0` means no per-minute rule is known for this provider and
   * none is enforced — the honest rendering of an unknown limit rather than an
   * invented one.
   */
  burstSpent: number;
  burstLimit: number;
  /**
   * Why a refusal happened, named rather than inferred: `window_exhausted`
   * (nothing until tomorrow), `burst_exhausted` (something in a moment),
   * `unknown_bucket` or `unknown_provider` (a typo, or an adapter whose id has
   * no budget row — a code problem wearing an exhausted-quota costume, which is
   * exactly the confusion this field exists to end). Null when allowed.
   */
  refusalReason: BudgetRefusalReason | null;
};

/** The refusals `consume_provider_requests` can return. Kept as a union so a
 * surface that renders one has to handle all of them. */
export type BudgetRefusalReason =
  | "window_exhausted"
  | "burst_exhausted"
  | "unknown_bucket"
  | "unknown_provider"
  | "ledger_unreachable";

/**
 * Reserves `count` provider requests for one bucket, atomically.
 *
 * The RPC does the counting and the insert inside one transaction behind an
 * advisory lock keyed on (provider, bucket) — see migration 0091 for why a
 * plain count-then-insert is not a budget under READ COMMITTED.
 *
 * **A failure to reach the ledger refuses.** That is the opposite of how most
 * degradation in this codebase works, and it is deliberate: everywhere else,
 * failing open costs a missing feature, and here it costs the account's daily
 * quota with nothing recording that it went. "I could not find out whether I am
 * allowed to spend" and "I am not allowed to spend" have to lead to the same
 * decision, for the same reason `claimSyncLock` returns null on error.
 */
export async function reserveProviderRequests(
  supabase: ServiceClient,
  provider: string,
  bucket: RequestBucket,
  count = 1,
): Promise<BudgetDecision> {
  const limit = PROVIDER_REQUEST_BUDGETS[bucket];

  // No limit argument: the ceiling is the database's, read from
  // provider_request_limit() inside the same transaction that spends. See this
  // module's note on PROVIDER_REQUEST_BUDGETS.
  const { data, error } = await supabase.rpc("consume_provider_requests", {
    p_provider: provider,
    p_bucket: bucket,
    p_window_seconds: REQUEST_BUDGET_WINDOW_SECONDS,
    p_count: count,
  });

  if (error) {
    logError("football.requestBudget.consume", error, { provider, bucket, count });
    return {
      allowed: false,
      spentInWindow: limit,
      limit,
      windowSeconds: REQUEST_BUDGET_WINDOW_SECONDS,
      oldestSpendAt: null,
      burstSpent: 0,
      burstLimit: 0,
      refusalReason: "ledger_unreachable",
    };
  }

  // The RPC returns a single-row set.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    logError("football.requestBudget.consume", "consume_provider_requests returned no row", { provider, bucket });
    return {
      allowed: false,
      spentInWindow: limit,
      limit,
      windowSeconds: REQUEST_BUDGET_WINDOW_SECONDS,
      oldestSpendAt: null,
      burstSpent: 0,
      burstLimit: 0,
      refusalReason: "ledger_unreachable",
    };
  }

  return {
    allowed: row.allowed,
    spentInWindow: row.spent_in_window,
    // The database's own ceiling, not the mirrored constant — so a drift
    // between the two shows up as an honest number here rather than as a
    // display that disagrees with the decision it is describing.
    limit: row.request_limit,
    windowSeconds: REQUEST_BUDGET_WINDOW_SECONDS,
    oldestSpendAt: row.oldest_spend_at,
    burstSpent: row.burst_spent,
    burstLimit: row.burst_limit,
    refusalReason: (row.refusal_reason as BudgetRefusalReason | null) ?? null,
  };
}

export type BucketUsage = {
  bucket: RequestBucket;
  limit: number;
  spentInWindow: number;
  oldestSpendAt: string | null;
  lastSpendAt: string | null;
};

/**
 * Reads the ledger without touching it — for the planner's pacing arithmetic
 * and for the admin panel.
 *
 * Reading and reserving are separate on purpose. The planner needs the numbers
 * to decide a pace, which is not a spend; the reservation happens once, later,
 * at the moment the request is actually about to be made. Merging them would
 * mean every pacing decision consumed a request, including the ones that decide
 * not to spend.
 */
export async function readBudgetUsage(supabase: ServiceClient, provider: string): Promise<BucketUsage[]> {
  const since = new Date(Date.now() - REQUEST_BUDGET_WINDOW_SECONDS * 1000).toISOString();

  const { data, error } = await supabase
    .from("provider_request_spend")
    .select("bucket, requests, spent_at")
    .eq("provider", provider)
    .gte("spent_at", since)
    .order("spent_at", { ascending: true });

  const buckets: RequestBucket[] = ["live", "auto", "daily", "catalogue"];

  if (error) {
    logError("football.requestBudget.read", error, { provider });
    // Reported as fully spent rather than as empty. An unreadable ledger must
    // not render as "nothing has been spent today" on an admin screen — that is
    // the one wrong answer that would make somebody turn the flag on.
    return buckets.map((bucket) => ({
      bucket,
      limit: PROVIDER_REQUEST_BUDGETS[bucket],
      spentInWindow: PROVIDER_REQUEST_BUDGETS[bucket],
      oldestSpendAt: null,
      lastSpendAt: null,
    }));
  }

  return buckets.map((bucket) => {
    const rows = (data ?? []).filter((row) => row.bucket === bucket);
    return {
      bucket,
      limit: PROVIDER_REQUEST_BUDGETS[bucket],
      spentInWindow: rows.reduce((sum, row) => sum + row.requests, 0),
      oldestSpendAt: rows[0]?.spent_at ?? null,
      lastSpendAt: rows.at(-1)?.spent_at ?? null,
    };
  });
}

/** Total allowance across every bucket, for the one line ENVIRONMENT.md needs
 * to give the founder a real number rather than a reassurance.
 *
 * Note this is now the total of FOUR buckets, three automated and one
 * (`catalogue`) admin-triggered. They are summed here because the number's job
 * is "how much of the tier is spoken for", which is a single scope — not
 * because automated and manual spending are the same thing. Anywhere the two
 * need distinguishing, read the buckets individually. */
export const TOTAL_AUTOMATED_REQUEST_BUDGET = Object.values(PROVIDER_REQUEST_BUDGETS).reduce((a, b) => a + b, 0);

/**
 * When this bucket last spent anything, or null if it has not inside the
 * window.
 *
 * Exists for the catalogue backfill's minute-rate guard. API-Football's free
 * tier caps requests per MINUTE (10) as well as per day, and the daily ledger
 * cannot see that: twelve requests spread over a day and twelve fired in ninety
 * seconds are identical to it, and only one of them gets a 429. The backfill
 * therefore checks this before a batch and refuses if the previous batch is
 * too recent — a refusal that costs nothing, rather than a burst that costs
 * requests and returns errors.
 */
export async function readLastSpendAt(
  supabase: ServiceClient,
  provider: string,
  bucket: RequestBucket,
): Promise<string | null> {
  const since = new Date(Date.now() - REQUEST_BUDGET_WINDOW_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from("provider_request_spend")
    .select("spent_at")
    .eq("provider", provider)
    .eq("bucket", bucket)
    .gte("spent_at", since)
    .order("spent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logError("football.requestBudget.readLastSpend", error, { provider, bucket });
    // An unreadable ledger reports "spent just now", which makes the caller
    // wait. Same fail-closed direction as reserveProviderRequests: not knowing
    // whether it is safe to spend and knowing it is not must lead to the same
    // decision.
    return new Date().toISOString();
  }
  return data?.spent_at ?? null;
}

/**
 * Bounded retention sweep for the ledger, run by the scheduled worker's janitor
 * step alongside `pruneRateLimitEvents`.
 *
 * Best-effort by contract: a ledger that fails to prune is a table that grows
 * slowly, which is not worth failing a sync over. Returns how many rows went,
 * for the same log line the rate-limit sweep already writes.
 */
export async function pruneProviderRequestSpend(supabase: ServiceClient): Promise<number> {
  const { data, error } = await supabase.rpc("prune_provider_request_spend", { p_max_rows: 5000 });
  if (error) {
    logError("football.requestBudget.prune", error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}


/**
 * The refusal, in a sentence an operator can act on.
 *
 * Each of these leads somewhere different, and before migration 0118 they were
 * all the same "budget refused" — which sent people to look at quota when the
 * real problem was a provider id with no budget row. The distinction between
 * "tomorrow", "in a moment" and "this is a code problem" is the entire value of
 * the field.
 *
 * Operator-facing only. A fan never sees any of this; `userFacingProviderMessage`
 * is what they get.
 */
export function describeBudgetRefusal(reason: BudgetRefusalReason | null, provider: string, bucket: RequestBucket): string {
  switch (reason) {
    case "window_exhausted":
      return `The ${bucket} allowance for ${provider} is spent for this rolling 24 hours. It frees up as the oldest spends fall out of the window — no action needed, and no key or plan problem.`;
    case "burst_exhausted":
      return `${provider} has taken too many requests in the last minute across all buckets. This clears on its own within the minute; it is a pacing refusal, not an exhausted day.`;
    case "unknown_bucket":
      return `"${bucket}" has no ceiling in provider_request_limit(), so it is refused everything. This is a code problem, not a quota problem — the bucket name is wrong or its row has not been added.`;
    case "unknown_provider":
      return `"${provider}" has no budget row, so every request from it is refused. Add it to provider_request_limit() and normalize_provider_id() in a migration — this is a code problem wearing an exhausted-quota costume.`;
    case "ledger_unreachable":
      return `The request ledger could not be read, so the spend was refused. Not knowing whether it is safe to spend and knowing it is not have to lead to the same decision.`;
    case null:
      return "Allowed.";
  }
}
