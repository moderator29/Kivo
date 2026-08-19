import "server-only";
import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { FOOTBALL_LIVE_POLLING_ENABLED, getActiveProviderStatus } from "@/lib/football";
import { syncTodayFixtures, type SyncTriggerSource } from "@/lib/football/sync";
import { syncStandings } from "@/lib/football/sync-match-details";
import { isAuthorizedCronRequest } from "@/lib/football/live-worker-rules";
import { planLiveSync, type LiveFixtureSnapshot } from "@/lib/football/live-sync-planner";
import {
  PROVIDER_REQUEST_BUDGETS,
  REQUEST_BUDGET_WINDOW_SECONDS,
  pruneProviderRequestSpend,
  readBudgetUsage,
  reserveProviderRequests,
} from "@/lib/football/request-budget";
import { pruneProviderCache } from "@/lib/football/cache";
import { pruneProviderRequestLog } from "@/lib/football/provider-telemetry";
import { logError } from "@/lib/log";
import { pruneRateLimitEvents } from "@/lib/rate-limit";
import { rescoreLiveGameweeks } from "@/lib/fantasy-live-scoring";
import { EMPTY_SETTLEMENT, settlePredictionsBestEffort } from "@/lib/prediction-settlement";

/**
 * The automated sync worker, shared by both scheduled entry points:
 * `/api/cron/sync-live` (once a minute, when something is driving it) and
 * `/api/cron/sync-daily` (once a day, which is the only cadence Vercel's Hobby
 * plan accepts). It lives here rather than in either route because a Next.js
 * route module may only export HTTP method handlers and route config, not a
 * function another route can import.
 *
 * Two callers exist for the once-a-minute path: Supabase pg_cron (migration
 * 0067, inert until the founder adds two Vault secrets) and Vercel Cron, if
 * KIVO ever moves to a plan that permits a sub-daily schedule. See
 * `DECISIONS.md`, "Automated sync trigger", for why pg_cron was chosen over
 * GitHub Actions and an external pinger.
 *
 * This is deliberately NOT "poll every minute, always fetch." A fixed-interval
 * schedule can only ever be "how often to *ask* whether there's work" — real
 * sports platforms (ESPN, Sofascore) throttle the *asking* against the
 * provider aggressively, only spending a real request when a match is
 * actually live or about to kick off, and staying quiet otherwise. So the
 * cron schedule itself stays dumb (fire every minute, unconditionally) and
 * every bit of "is this actually worth a provider call right now" judgment
 * lives here, in order, each one capable of ending the request as a no-op:
 *
 *   1. Auth — reject anything that isn't Vercel itself (CRON_SECRET).
 *   2. FOOTBALL_LIVE_POLLING_ENABLED — the real, standing safety gate. Off by
 *      default; only the founder flips it, in Vercel, once they've decided
 *      the account can absorb the request volume. This route is the second
 *      real thing this flag now guards (see its doc comment in
 *      src/lib/football/index.ts) — while it's false, every single one of
 *      these once-a-minute invocations is a same-millisecond no-op.
 *   3. A real provider must actually be configured (mirrors
 *      requireFootballDataAccess in admin/data-health/actions.ts) — never run
 *      against nothing just because a cron fired.
 *   4. Dedup — does any run (cron or admin) currently hold the fixtures sync
 *      lease? (The prerequisite docs/LIVE_DATA.md flagged as missing: "dedup
 *      logic proven under concurrent/overlapping worker runs — not built".
 *      KN-82 replaced the original two-minute heuristic with a real lease;
 *      see step 3 in the code below.)
 *   5. The plan (`live-sync-planner.ts`): is anything actually in play, is
 *      there budget left, and is it time yet? This one gate replaced two —
 *      the old "is anything live" check and the old quota floor — because
 *      neither of them bounded TOTAL spend, which was the real hole. The
 *      floor only refused once the provider's own remaining count was already
 *      at ten, and that count is null until some request has recorded one, so
 *      on a fresh day the exact window where a once-a-minute worker is most
 *      likely to run away was the window where the guard was asleep.
 *   6. The reservation (`request-budget.ts`, migration 0091): an atomic
 *      consume against this worker's own allowance. Asking and spending are
 *      one statement, so two workers cannot both pass a check and both spend,
 *      and a refusal means the provider client is never constructed at all.
 *
 * Only once every one of those passes does this spend a real provider call,
 * via the exact same syncTodayFixtures() the admin "Sync now" button and
 * triggerLiveScoresRefresh already use — this worker is a new *caller*, not
 * a new sync path, so it plugs straight into infrastructure (upsert RPCs,
 * notification fan-out, Realtime distribution) already proven correct.
 *
 * Every decision this route makes — including every no-op — writes a
 * `sync_runs` row (`trigger_source: "cron"`, migration 0044) so Admin ->
 * Data Health can show this worker's history distinctly from admin-clicked
 * syncs: not just "did it sync" but "did it even run, and what did it decide
 * each time." A `status: "skipped"` row (migration 0044) with a plain-English
 * `error_message` is how every no-op above is recorded — genuinely not
 * 'running'/'success'/'partial'/'failed', so it doesn't get one of those
 * inaccurate labels forced onto it.
 */

const QUOTA_SAFETY_FLOOR = 10;
/**
 * Why 10, not a computed 5% of some tracked daily total: this codebase has
 * never stored a "daily quota total" anywhere (see docs/API_QUOTA.md, "What
 * doesn't exist" — only the provider's own *remaining* count is ever known,
 * via the x-ratelimit-requests-remaining response header). Inventing a total
 * to divide against would mean fabricating a number this app has never
 * actually observed, which is exactly the kind of made-up data this
 * platform's standing rule forbids. 10 is instead the same absolute
 * threshold Data Health's own UI already uses to color the "requests left
 * today" pill amber (src/app/admin/data-health/page.tsx) — reusing it here
 * means the automated worker and the human-facing warning agree on what
 * "running low" means, and an admin who's seen that pill go amber already
 * knows, without reading this file, roughly when the worker will start
 * declining to run on its own. On API-Football's free tier (100 req/day —
 * see docs/API_FOOTBALL.md), 10 remaining is the last ~10% of a day's quota;
 * reserved so a human actively debugging via "Sync now" always has room,
 * rather than the automated worker being the thing that spends the account's
 * very last requests of the day.
 */

const IMMINENT_WINDOW_MINUTES = 10;
/**
 * A 'scheduled' fixture whose kickoff has already passed by more than this
 * is treated as stale, not imminent — a typical match (incl. added time) is
 * long over well within 3 hours. Without this ceiling, a fixture the
 * provider never flipped to 'live'/'finished' (a provider data gap, not
 * something this worker can fix by asking again) would otherwise look
 * "imminent" (kickoff in the past counts as "within 10 minutes of now")
 * forever, and this worker would spend a provider call on it every single
 * minute, indefinitely. Past that ceiling it's back to admin-triggered
 * "Sync now" territory, same as any other stale fixture.
 */
const STALE_SCHEDULED_CEILING_HOURS = 3;

type ServiceClient = SupabaseClient<Database>;

/**
 * Every no-op path funnels through here so Data Health sees a complete
 * decision history, not just the runs that actually synced. Mirrors the
 * shape syncTodayFixtures itself writes on completion (finished_at ==
 * started_at, records_processed 0) but with status 'skipped' instead of a
 * real terminal status — see this file's module doc comment.
 */
/**
 * KIVO_NEXT_GEN KN-99. Writing a row for every no-op was right when nothing
 * called this route. Now that something does — every minute — it is not: the
 * two steady-state no-ops ("polling is off", "nothing is live") would each
 * produce 1,440 identical rows a day, which is not a decision history, it is a
 * table full of the same sentence.
 *
 * So a no-op that describes a *standing condition* is recorded once and then
 * suppressed until the condition changes or the window lapses. A no-op that
 * describes something going *wrong* — a failed dedup check, a failed fixtures
 * query — is still recorded every single time, because those are events, not
 * conditions, and the count matters.
 *
 * Nothing is lost by the suppression: `cron.job_run_details` (migration 0067)
 * records every firing of the scheduler independently, so "did it even run" is
 * answerable without this table having to carry it.
 */
const STEADY_STATE_SUPPRESSION_MINUTES = 30;

async function logSkippedRun(
  supabase: ServiceClient,
  params: {
    provider: string;
    reason: string;
    triggerSource: SyncTriggerSource;
    quotaRemaining?: number | null;
    /** Set for a standing condition: a stable prefix of `reason` used to find a
     * recent identical row. Omitted means "always record this one". */
    suppressIfRecentPrefix?: string;
  },
): Promise<void> {
  if (params.suppressIfRecentPrefix) {
    const since = new Date(Date.now() - STEADY_STATE_SUPPRESSION_MINUTES * 60_000).toISOString();
    const { data: recent, error: lookupError } = await supabase
      .from("sync_runs")
      .select("id")
      .eq("entity_type", "fixture")
      .eq("trigger_source", params.triggerSource)
      .eq("status", "skipped")
      .gte("started_at", since)
      .like("error_message", `${params.suppressIfRecentPrefix}%`)
      .limit(1)
      .maybeSingle();

    // A failed lookup falls through and writes the row. Over-recording a no-op
    // is a much cheaper mistake than silently dropping the only trace of one.
    if (lookupError) logError("cron.sync-live.suppression-check", lookupError, { reason: params.reason });
    else if (recent) return;
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("sync_runs").insert({
    provider: params.provider,
    entity_type: "fixture",
    status: "skipped",
    trigger_source: params.triggerSource,
    started_at: now,
    finished_at: now,
    last_synced_at: null,
    records_processed: 0,
    error_message: params.reason,
    provider_quota_remaining: params.quotaRemaining ?? null,
  });
  if (error) {
    logError("cron.sync-live.log-skipped-run", error, { reason: params.reason });
  }
}

/**
 * How many league tables the daily baseline refreshes per run. Six requests a
 * day (one for fixtures, five for tables) against a hundred-a-day free tier
 * leaves the overwhelming majority of the budget for the surfaces a human is
 * actually looking at.
 */
const DAILY_STANDINGS_BUDGET = 5;

/**
 * Refreshes up to `DAILY_STANDINGS_BUDGET` league tables, least-recently-synced
 * first, so every current season comes round rather than the same one being
 * refreshed forever.
 *
 * "Least recently synced" is read from each season's own newest successful
 * standings run rather than from a column on `seasons`, so it needs no new
 * schema and cannot drift out of agreement with what actually happened. A
 * season that has never been synced sorts first, which is what makes an empty
 * database fill in rather than stay empty.
 *
 * Best-effort throughout: a failure here must not make the fixtures sync — the
 * important half — report itself as broken.
 */
async function syncStaleStandings(reserveOne: () => Promise<boolean>): Promise<{ synced: number }> {
  try {
    const supabase = createServiceRoleSupabaseClient();

    const { data: seasons, error } = await supabase
      .from("seasons")
      .select("id")
      .eq("is_current", true)
      .limit(100);
    if (error || !seasons || seasons.length === 0) {
      if (error) logError("cron.sync-daily.seasons", error);
      return { synced: 0 };
    }

    // Recency comes from the standings rows themselves, not from `sync_runs`
    // (which does not record which season a run covered) and not from a new
    // column (which would be a second source of truth for something the data
    // already knows). `standings.updated_at` is touched by the upsert on every
    // refresh, so the newest row per season is exactly when that table was last
    // refreshed — and a season with no standings rows at all has no entry here,
    // which sorts it first.
    const { data: standingRows } = await supabase
      .from("standings")
      .select("season_id, updated_at")
      .in("season_id", seasons.map((s) => s.id))
      .order("updated_at", { ascending: false })
      .limit(1000);

    const lastRefreshed = new Map<string, number>();
    for (const row of standingRows ?? []) {
      const at = new Date(row.updated_at).getTime();
      const known = lastRefreshed.get(row.season_id);
      if (known === undefined || at > known) lastRefreshed.set(row.season_id, at);
    }

    const targets = [...seasons]
      // Never refreshed sorts first (-Infinity), then oldest first. Ties break
      // on id so the order is stable rather than dependent on row order.
      .sort((a, b) => {
        const aAt = lastRefreshed.get(a.id) ?? Number.NEGATIVE_INFINITY;
        const bAt = lastRefreshed.get(b.id) ?? Number.NEGATIVE_INFINITY;
        return aAt === bAt ? a.id.localeCompare(b.id) : aAt - bAt;
      })
      .slice(0, DAILY_STANDINGS_BUDGET);

    let synced = 0;
    for (const season of targets) {
      // Reserved per table, immediately before the request. The cap above is
      // how many tables are CHOSEN; this is what makes it a cap on what is
      // SPENT — the two can otherwise disagree the moment somebody raises the
      // constant without thinking about the tier.
      if (!(await reserveOne())) break;
      const result = await syncStandings(season.id);
      if (result.status !== "failed") synced += 1;
    }
    return { synced };
  } catch (error) {
    logError("cron.sync-daily.standings", error);
    return { synced: 0 };
  }
}

/**
 * The stable prefix each planner skip reason is deduplicated on.
 *
 * Every one of these is a STANDING CONDITION rather than an event, which is
 * what earns suppression (see `logSkippedRun`). At one firing a minute, an
 * unsuppressed "pacing" row would be 1,440 rows a day saying the worker is
 * working normally — a table full of one sentence rather than a decision
 * history. `cron.job_run_details` (migration 0067) still records every firing
 * independently, so "did it even run" never depended on this table.
 */
const SKIP_SUPPRESSION_PREFIX: Record<"nothing_live" | "quota_floor" | "budget_exhausted" | "pacing", string> = {
  nothing_live: "Skipped: Nothing is in play",
  quota_floor: "Skipped: The provider reports",
  budget_exhausted: "Skipped: The live worker has spent its whole allowance",
  pacing: "Skipped: Last refresh was",
};

/**
 * How long a fixture may sit in `live`/`halftime` without the live feed
 * mentioning it before KIVO treats it as having disappeared.
 *
 * Generous on purpose. The live feed is polled at a derived pace that can be as
 * slow as fifteen minutes, so anything shorter would call a fixture missing
 * simply because the worker had not looked recently. This is "the worker has
 * looked, more than once, and this match was not there".
 */
const RECONCILE_STALE_MINUTES = 35;

/** At most one dated fetch per invocation, whatever has disappeared. One
 * request settles every fixture on the same day at once, and a worker that
 * could spend several per firing would have a second unbounded path in it. */
const RECONCILE_FETCH_LIMIT = 1;

/**
 * The bounded fallback for fixtures that vanished from the live feed.
 *
 * `/fixtures?live=all` returns ONLY in-play matches, so a fixture that goes
 * final between two polls stops appearing — and without this its last written
 * state is an in-play scoreline that stays on the product until the next daily
 * sync. That is not a stale score, it is a permanently wrong one, and it is the
 * decisive argument against using the live feed alone.
 *
 * THE BOUND MATTERS AS MUCH AS THE FALLBACK. A fixture also disappears when the
 * provider hiccups, when a match is briefly misreported, or during a short
 * outage. If every disappearance meant "keep asking until it is final", a
 * flapping provider would cost one request per minute per fixture — the exact
 * runaway this whole pass exists to remove. So:
 *
 *   - exactly one dated fetch per disappearance, tracked by
 *     `fixtures.live_reconciled_at` against `provider_last_seen_at`. A second
 *     attempt happens only if the fixture came back and vanished again, which
 *     is a genuinely new disappearance rather than a retry of the same one;
 *   - the attempt is marked as made even when the fetch FAILS. A failed request
 *     has already been spent, and retrying it immediately spends another;
 *   - it comes out of the live worker's own allowance, with no exemption. An
 *     allowance with a carve-out is not a ceiling;
 *   - at most one fetch per invocation.
 *
 * If the dated fetch does not show the fixture as finished, nothing more
 * happens here. The daily baseline will settle it, and KN-86's absence flagging
 * will raise it for a human if it never resolves.
 */
async function reconcileDisappearedFixtures(supabase: ServiceClient, providerLabel: string): Promise<number> {
  const staleBefore = new Date(Date.now() - RECONCILE_STALE_MINUTES * 60_000).toISOString();

  const { data: stranded, error } = await supabase
    .from("fixtures")
    .select("id, kickoff_at, provider_last_seen_at, live_reconciled_at")
    .in("status", ["live", "halftime"])
    .lt("provider_last_seen_at", staleBefore)
    .limit(20);

  if (error) {
    logError("cron.sync-live.reconcile-query", error);
    return 0;
  }

  const candidates = (stranded ?? []).filter(
    (fixture) =>
      fixture.provider_last_seen_at !== null &&
      (fixture.live_reconciled_at === null ||
        new Date(fixture.live_reconciled_at).getTime() < new Date(fixture.provider_last_seen_at).getTime()),
  );
  if (candidates.length === 0) return 0;

  const reservation = await reserveProviderRequests(supabase, providerLabel, "live", RECONCILE_FETCH_LIMIT);
  if (!reservation.allowed) {
    // Deliberately NOT marked as attempted. Nothing was spent, so nothing was
    // attempted, and these fixtures should be reconciled once the allowance
    // frees up rather than being written off.
    return 0;
  }

  // One dated fetch settles every fixture on that day at once. The oldest
  // stranded fixture's own day is used rather than "today", because a match
  // that kicked off at 23:00 UTC and went final after midnight belongs to
  // yesterday's fixture list.
  const targetDate = candidates
    .map((fixture) => fixture.kickoff_at.slice(0, 10))
    .sort()[0];

  const result = await syncTodayFixtures("cron", { targetDate });

  // Marked whatever happened, including on failure. See this function's doc
  // comment: a failed request has already been spent.
  const { error: markError } = await supabase
    .from("fixtures")
    .update({ live_reconciled_at: new Date().toISOString() })
    .in(
      "id",
      candidates.map((fixture) => fixture.id),
    );
  if (markError) logError("cron.sync-live.reconcile-mark", markError);

  if (result.status === "failed") {
    logError("cron.sync-live.reconcile-fetch", result.error ?? "dated reconciliation fetch failed", { targetDate });
  }

  return candidates.length;
}

/**
 * The shared handler behind both scheduled entry points.
 *
 * `mode` is a real parameter rather than something read off the URL, because
 * Vercel's cron documentation only ever shows a bare path — a query string in
 * `vercel.json`'s `crons[].path` is undocumented, and a `vercel.json` that
 * fails validation blocks every deployment, which cost the founder hours
 * earlier today. Two routes with an explicit argument cannot fail that way.
 */
export async function handleScheduledSync(request: Request, mode: "live" | "daily") {
  // isAuthorizedCronRequest (src/lib/football/live-worker-rules.ts, unit-tested
  // there) enforces Vercel's own documented pattern
  // (https://vercel.com/docs/cron-jobs/manage-cron-jobs, "Securing cron jobs"):
  // Vercel populates CRON_SECRET and sends it back as a Bearer token on every
  // request it makes to a scheduled path. ENVIRONMENT.md previously listed
  // CRON_SECRET as "reserved, not used" (RECOMMENDATIONS.md item 220) — this
  // is that reservation becoming real. Whether Vercel's production cron
  // infrastructure genuinely sends this header on a real scheduled invocation
  // is NOT something this sandbox can verify — there is no way to trigger a
  // real Vercel Cron firing from here (see docs/LIVE_DATA.md); this enforces
  // the documented contract, which is the most that's verifiable without a
  // live deployment.
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    // Distinguish "nobody has set CRON_SECRET on this deployment yet" (a
    // deploy-config problem worth a loud 500) from "wrong/missing token on an
    // otherwise-configured deployment" (a real 401). Neither path writes a
    // sync_runs row: an unauthenticated hit
    // never got far enough to make a real decision about anything, and
    // logging one would let an unauthenticated caller pollute Data Health's
    // history for free.
    if (!process.env.CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 500 });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  /**
   * Two modes, because two schedulers with completely different budgets call
   * this one route (founder instruction, 2026-08-18).
   *
   *   `live`  (default) — the once-a-minute worker. Every gate below applies,
   *                       including FOOTBALL_LIVE_POLLING_ENABLED, because at
   *                       that cadence an ungated worker would drain a
   *                       100-request free tier in under two hours.
   *   `daily`           — the once-a-day baseline, which is the only cadence
   *                       Vercel's Hobby plan accepts. It exists to stop the
   *                       database being empty, so it deliberately does not
   *                       consult FOOTBALL_LIVE_POLLING_ENABLED (that flag
   *                       protects against per-minute burn; one request a day
   *                       cannot burn anything) and does not require anything
   *                       to be live right now (there is nothing to be "worth"
   *                       a call about if the database has no fixtures in it
   *                       yet — that is the situation it fixes).
   *
   * Everything that protects the account still applies to both: auth, a real
   * provider being configured, the sync lease, and the quota floor.
   */
  const triggerSource: SyncTriggerSource = mode === "daily" ? "daily" : "cron";

  // The same posture as the CRON_SECRET branch above, and for a sharper
  // reason. `createServiceRoleSupabaseClient()` throws *synchronously*
  // ("supabaseKey is required.") when SUPABASE_SERVICE_ROLE_KEY is absent or
  // was never copied into this environment. Unguarded, that throw escaped the
  // route entirely: Vercel's scheduled call got a bare 500 with no body, no
  // `sync_runs` row was written, and Data Health's automation panel therefore
  // reported "Never run" — which is *true*, and indistinguishable from
  // "CRON_SECRET is missing", from "vercel.json was never deployed", and from
  // "this plan does not run crons". Three unrelated causes, one symptom, on
  // the one surface built specifically to stop that happening.
  //
  // Verified by running the built app with the key absent: `GET
  // /api/cron/sync-daily` with a valid bearer token returned 500 with an empty
  // body and logged `supabaseKey is required.` A deployment problem must name
  // itself.
  let supabase: ReturnType<typeof createServiceRoleSupabaseClient>;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured" },
      { status: 500 },
    );
  }
  // Sync, side-effect-free — never constructs a provider client or spends
  // quota just to label a log row (see its doc comment in src/lib/football/index.ts).
  const { name: activeProviderName } = getActiveProviderStatus();
  const providerLabel = activeProviderName ?? "unconfigured";

  // KIVO_NEXT_GEN KN-93. Deliberately the first thing after auth, and
  // deliberately above every football gate below it: expiring rate-limit rows
  // has nothing to do with whether a match is live or whether polling is
  // enabled, and hanging it off those gates would mean the table is only ever
  // swept on matchdays. This is the scheduled janitor that lets
  // `checkRateLimit` stop doing a full-table delete inside a user request.
  //
  // Bounded per call by the SQL function itself, so a long backlog clears over
  // several runs rather than in one long delete. Best-effort by contract — it
  // cannot fail this request or change any decision made below it.
  const pruned = await pruneRateLimitEvents();
  if (pruned > 0) console.info(`Cron: pruned ${pruned} expired rate_limit_events rows`);

  // The request ledger only ever answers questions about a trailing window, so
  // anything older than a few of them is dead weight. Same contract as above:
  // bounded per call, best-effort, cannot fail this request or change any
  // decision below it.
  const prunedSpend = await pruneProviderRequestSpend(supabase);
  if (prunedSpend > 0) console.info(`Cron: pruned ${prunedSpend} expired provider_request_spend rows`);

  // The two tables migration 0118 added, swept on the same contract as the two
  // above: bounded per call by their own SQL functions, best-effort, and unable
  // to fail this request or change any decision below it. Without this they are
  // the only append-only tables in the football path with no janitor at all —
  // the response cache keeps bodies a day past their stale window so an outage
  // can still be survived, and the request log keeps a fortnight so the Admin
  // provider page has something to draw a trend from.
  const prunedCache = await pruneProviderCache(supabase);
  if (prunedCache > 0) console.info(`Cron: pruned ${prunedCache} expired provider_response_cache rows`);

  const prunedLog = await pruneProviderRequestLog(supabase);
  if (prunedLog > 0) console.info(`Cron: pruned ${prunedLog} expired provider_request_log rows`);

  /**
   * Settle predictions, and score fantasy gameweeks that are already over.
   *
   * Deliberately here — above every football gate below it, next to the
   * janitors, and for the same reason they are here. Neither of these spends a
   * provider request: every input is a row KIVO already holds, so gating them
   * behind "is a provider configured", "is anything live", "is there budget
   * left" or the sync lease would mean the one thing that has to happen every
   * day only happens on days KIVO also had quota to spend. That inversion is
   * how a fan ends up making a correct call that is never scored.
   *
   * Daily only. The live worker fires once a minute and settles as part of its
   * own success path further down, right after a sync that may have just
   * written the full-time score — which is what gets a prediction settled
   * within a minute of the whistle rather than within a day of it.
   *
   * Best-effort by contract, like the prunes above: neither can fail this
   * request or change any decision made below it.
   */
  let settlement = EMPTY_SETTLEMENT;
  let dailyFantasyGameweeksScored = 0;
  if (mode === "daily") {
    settlement = await settlePredictionsBestEffort(supabase);
    try {
      // The live path re-scores gameweeks that are in play; nothing was scoring
      // the ones that had simply finished on a deployment where the live worker
      // is not armed — which is every deployment until the founder arms it.
      // Same function, same provisional/final semantics, once a day.
      const dailyScoring = await rescoreLiveGameweeks(supabase);
      dailyFantasyGameweeksScored = dailyScoring.gameweeksScored;
    } catch (error) {
      logError("cron.sync-daily.fantasy-scoring", error);
    }
  }

  /**
   * The three numbers, on every exit a daily run can take — not only the happy
   * one. "Settled 0, unresolved 40" and "the sync skipped so nothing ran" are
   * different facts, and a response that only reports settlement when the
   * football sync also succeeded makes them indistinguishable. That is the same
   * failure mode Data Health's automation panel exists to prevent.
   */
  const settlementReport = {
    predictionsSettled: settlement.settled,
    predictionsUnresolved: settlement.unresolved,
    predictionsAdjusted: settlement.adjusted,
    fantasyGameweeksScored: dailyFantasyGameweeksScored,
  };

  // 1. The real gate. Never flip this from code — see FOOTBALL_LIVE_POLLING_ENABLED's
  // own doc comment.
  // `daily` deliberately skips this gate — see the mode note above. The flag is
  // the founder's protection against a once-a-minute worker, and it is only
  // ever read here, never written: flipping it from code is forbidden.
  if (mode === "live" && !FOOTBALL_LIVE_POLLING_ENABLED) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: "Skipped: FOOTBALL_LIVE_POLLING_ENABLED is false.",
      suppressIfRecentPrefix: "Skipped: FOOTBALL_LIVE_POLLING_ENABLED",
    });
    return NextResponse.json({ ok: true, decision: "polling_disabled" });
  }

  // 2. Mirrors requireFootballDataAccess in admin/data-health/actions.ts — never
  // run against nothing (or silently fall through to the dev-only mock
  // provider) just because a cron fired against a not-yet-configured deploy.
  if (!process.env.API_FOOTBALL_KEY) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: "Skipped: no real football data provider is configured (API_FOOTBALL_KEY unset).",
      suppressIfRecentPrefix: "Skipped: no real football data provider",
    });
    return NextResponse.json({ ok: true, decision: "no_provider_configured", ...settlementReport });
  }

  // 3. Dedup. This used to be a heuristic: "is there a cron-triggered
  // sync_runs row with status 'running' from the last two minutes". KN-82 and
  // KN-4 between them show why that was not enough — a run killed mid-flight
  // leaves a permanently-'running' row that suppresses the next real run until
  // it ages out, and the query only ever looked at cron rows, so an admin
  // clicking "Sync now" and this worker could collide freely and spend the
  // same quota twice.
  //
  // The real answer is the lease `syncTodayFixtures` now takes (migration
  // 0056): one row per (provider, entity_type), with an expiry, held by
  // whoever is actually running regardless of who triggered them. Reading it
  // here is a precise question — "does an unexpired lease exist" — and lets
  // this route decline *before* creating a run row, rather than starting one
  // that immediately skips.
  //
  // `syncTodayFixtures` still claims the lease itself; this check is not the
  // guarantee, it is the cheap early exit. The guarantee is the atomic claim,
  // which is what makes the race between this read and that claim harmless.
  const { data: heldLock, error: dedupError } = await supabase
    .from("sync_locks")
    .select("holder, acquired_at, expires_at")
    .eq("provider", providerLabel)
    .eq("entity_type", "fixture")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (dedupError) {
    logError("cron.sync-live.dedup-check", dedupError);
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: dedup check failed, refusing to risk a concurrent run (${dedupError.message}).`,
    });
    return NextResponse.json({ ok: false, decision: "dedup_check_failed", ...settlementReport }, { status: 500 });
  }

  if (heldLock) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: a ${heldLock.holder ?? "unknown"} sync run holds the fixtures lock (since ${heldLock.acquired_at}, lease until ${heldLock.expires_at}).`,
    });
    return NextResponse.json({ ok: true, decision: "already_running", ...settlementReport });
  }

  // 4. The provider's own remaining count, read from the durable record rather
  // than by spending a request to ask. Passed to the planner, which treats null
  // as "KIVO has never recorded a reading" and never as "we are out" — guessing
  // low is not protecting, it is refusing to work.
  const { data: latestQuotaRun } = await supabase
    .from("sync_runs")
    .select("provider_quota_remaining")
    .not("provider_quota_remaining", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const quotaRemaining = latestQuotaRun?.provider_quota_remaining ?? null;

  // ---------------------------------------------------------------------------
  // The daily baseline. Budgeted from its own allowance, which the live worker
  // cannot reach — so a live worker that has spent everything still leaves
  // tomorrow's fixtures able to sync.
  // ---------------------------------------------------------------------------
  if (mode === "daily") {
    const reservation = await reserveProviderRequests(supabase, providerLabel, "daily");
    if (!reservation.allowed) {
      await logSkippedRun(supabase, {
        provider: providerLabel,
        triggerSource,
        reason: `Skipped: the daily baseline has spent its allowance (${reservation.spentInWindow} of ${reservation.limit} in the last 24 hours).`,
        quotaRemaining,
        suppressIfRecentPrefix: "Skipped: the daily baseline has spent",
      });
      return NextResponse.json({ ok: true, decision: "budget_exhausted", mode, ...settlementReport });
    }

    const dailyResult = await syncTodayFixtures("daily");

    /**
     * Fixtures alone leave every league table empty, because standings are a
     * separate provider call per competition-season. So the daily run also
     * refreshes a few tables — and the cap is the whole design, not a
     * limitation of it.
     *
     * With `FOOTBALL_SYNC_COMPETITION_IDS` unset, a day's fixtures can span
     * fifty competitions, and one standings call each would spend half a
     * hundred-request daily budget before lunch. Refreshing a bounded few per
     * day, **least-recently-synced first**, fills every table in within days
     * and then keeps them all rolling — which is the right trade for data that
     * changes at most once a matchday.
     *
     * Each table now also reserves before it is fetched, so the cap is enforced
     * by the ledger rather than only by a constant that a future edit could
     * raise without noticing what it costs.
     */
    const standings = await syncStaleStandings(async () => {
      const perTable = await reserveProviderRequests(supabase, providerLabel, "daily");
      return perTable.allowed;
    });

    return NextResponse.json(
      {
        ok: dailyResult.status !== "failed",
        decision: "synced",
        mode,
        status: dailyResult.status,
        recordsProcessed: dailyResult.recordsProcessed,
        standingsSeasonsSynced: standings.synced,
        ...settlementReport,
        error: dailyResult.error ?? null,
      },
      { status: dailyResult.status === "failed" ? 500 : 200 },
    );
  }

  // ---------------------------------------------------------------------------
  // The live worker.
  // ---------------------------------------------------------------------------
  // The database query stays coarse and cheap — any live/halftime row, or any
  // scheduled row kicking off by the imminent window's upper bound (existing
  // indexes on fixtures(status)/fixtures(kickoff_at), migrations 0001/0021,
  // already cover it), capped at 50 candidates. Every real judgment is the
  // planner's, which is pure and unit-tested; duplicating any of it as a second
  // raw SQL expression would create a second, untested source of truth for how
  // a hundred-request budget is spent.
  //
  // `imminentBy` is a server-computed ISO string, never user input, so
  // interpolating it into a raw .or() filter is safe.
  const imminentBy = new Date(Date.now() + IMMINENT_WINDOW_MINUTES * 60_000).toISOString();

  const { data: candidateFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, status, kickoff_at, minute_elapsed, updated_at")
    .or(`status.eq.live,status.eq.halftime,and(status.eq.scheduled,kickoff_at.lte.${imminentBy})`)
    .limit(50);

  if (fixturesError) {
    logError("cron.sync-live.fixtures-check", fixturesError);
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: couldn't check for live/imminent fixtures (${fixturesError.message}).`,
      quotaRemaining,
    });
    return NextResponse.json({ ok: false, decision: "fixtures_check_failed" }, { status: 500 });
  }

  const snapshots: LiveFixtureSnapshot[] = (candidateFixtures ?? []).map((fixture) => ({
    status: fixture.status,
    kickoffAt: fixture.kickoff_at,
    minuteElapsed: fixture.minute_elapsed,
    updatedAt: fixture.updated_at,
  }));

  // The ledger is READ here, not consumed. The planner needs the numbers to
  // derive a pace, which is not a spend — merging the read and the reservation
  // would mean every pacing decision consumed a request, including the ones
  // that decide not to spend.
  const usage = await readBudgetUsage(supabase, providerLabel);
  const liveUsage = usage.find((entry) => entry.bucket === "live");

  const plan = planLiveSync({
    now: new Date(),
    fixtures: snapshots,
    lastSpendAt: liveUsage?.lastSpendAt ?? null,
    budget: {
      limit: liveUsage?.limit ?? PROVIDER_REQUEST_BUDGETS.live,
      spentInWindow: liveUsage?.spentInWindow ?? 0,
      windowSeconds: REQUEST_BUDGET_WINDOW_SECONDS,
      oldestSpendAt: liveUsage?.oldestSpendAt ?? null,
    },
    quotaRemaining,
    quotaFloor: QUOTA_SAFETY_FLOOR,
    imminentWindowMinutes: IMMINENT_WINDOW_MINUTES,
    staleScheduledCeilingHours: STALE_SCHEDULED_CEILING_HOURS,
  });

  if (plan.action === "skip") {
    // "Pacing" is the one skip reason that is neither a standing condition nor
    // something going wrong — it is the normal heartbeat between refreshes, and
    // at one firing a minute it would otherwise write a row every minute of
    // every live match. Suppressed like the other standing conditions; the
    // scheduler's own `cron.job_run_details` (migration 0067) still records
    // that the worker ran, so nothing about "did it fire" depends on this table.
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: ${plan.detail}`,
      quotaRemaining,
      suppressIfRecentPrefix: SKIP_SUPPRESSION_PREFIX[plan.reason],
    });
    return NextResponse.json({
      ok: true,
      decision: plan.reason,
      nextEligibleAt: plan.nextEligibleAt,
    });
  }

  // 6. The reservation. This is the enforcement, and it is deliberately the
  // last thing before the request: a refusal here means the provider client is
  // never constructed and nothing is spent, and because the consume is atomic,
  // two workers cannot both be told yes.
  const reservation = await reserveProviderRequests(supabase, providerLabel, "live");
  if (!reservation.allowed) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: the live worker has spent its allowance (${reservation.spentInWindow} of ${reservation.limit} in the last 24 hours). Scores will not refresh until some of it frees up.`,
      quotaRemaining,
      suppressIfRecentPrefix: "Skipped: the live worker has spent",
    });
    return NextResponse.json({ ok: true, decision: "budget_exhausted" });
  }

  // `/fixtures?live=all` rather than a whole day: one request refreshes every
  // in-play match at once, and it cannot be thrown off by a match that belongs
  // to tomorrow's date in some timezone. syncTodayFixtures writes its own
  // sync_runs row (trigger_source 'cron') — no separate logging here.
  const result = await syncTodayFixtures("cron", { source: "live" });

  // The live feed returns ONLY in-play matches, so a fixture that went final
  // between two polls has simply vanished from it — and its last written state
  // would be an in-play scoreline that stays on the product until the next
  // daily sync. Not stale: wrong. This is the bounded fallback.
  const reconciled = await reconcileDisappearedFixtures(supabase, providerLabel);

  /**
   * Fantasy points that move during a match.
   *
   * Runs here rather than on its own schedule because it depends entirely on
   * what the sync above just wrote, and because it must never cause a provider
   * request — it reads only KIVO's own tables, so it adds nothing to the
   * budget this invocation already reserved.
   *
   * Best-effort by contract: the fixtures sync has already succeeded by this
   * point, and a fantasy scoring failure must not make it report itself as
   * broken. Every row it writes carries `status = 'provisional'` and the
   * fixture counts that explain why, so a mid-match total says what it is
   * rather than looking settled.
   */
  let fantasyGameweeksScored = 0;
  try {
    const liveScoring = await rescoreLiveGameweeks(supabase);
    fantasyGameweeksScored = liveScoring.gameweeksScored;
  } catch (error) {
    logError("cron.sync-live.fantasy-scoring", error);
  }

  /**
   * And settle predictions, on the same terms: the sync immediately above may
   * have just written a full-time score, and this is what turns that into a
   * settled prediction within a minute of the whistle rather than within a day
   * of it. Costs nothing against the provider — the request for this minute has
   * already been spent, and settlement reads only KIVO's own rows.
   *
   * Only on the success path, which is the throttle: the live worker fires
   * every minute, but this runs at the planner's pace rather than the
   * scheduler's, so a quiet hour does no settlement work at all.
   */
  const liveSettlement = await settlePredictionsBestEffort(supabase);

  return NextResponse.json(
    {
      ok: result.status !== "failed",
      decision: "synced",
      status: result.status,
      recordsProcessed: result.recordsProcessed,
      paceMinutes: Number(plan.paceMinutes.toFixed(2)),
      nextEligibleAt: plan.nextEligibleAt,
      budget: { spent: reservation.spentInWindow, limit: reservation.limit },
      reconciledFixtures: reconciled,
      fantasyGameweeksScored,
      predictionsSettled: liveSettlement.settled,
      predictionsUnresolved: liveSettlement.unresolved,
      predictionsAdjusted: liveSettlement.adjusted,
      error: result.error ?? null,
    },
    { status: result.status === "failed" ? 500 : 200 },
  );
}

