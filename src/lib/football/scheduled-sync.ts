import "server-only";
import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { FOOTBALL_LIVE_POLLING_ENABLED, getActiveProviderStatus } from "@/lib/football";
import { syncTodayFixtures, type SyncTriggerSource } from "@/lib/football/sync";
import { syncStandings } from "@/lib/football/sync-match-details";
import { isAuthorizedCronRequest, isFixtureWorthSyncing } from "@/lib/football/live-worker-rules";
import { logError } from "@/lib/log";
import { pruneRateLimitEvents } from "@/lib/rate-limit";

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
 *   5. Quota floor — is there enough of today's provider quota left to
 *      spend automatically, unsupervised? (See QUOTA_SAFETY_FLOOR below.)
 *   6. Is anything in `fixtures` actually live/halftime, or scheduled to kick
 *      off within IMMINENT_WINDOW_MINUTES? Nothing live/imminent -> no-op.
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
async function syncStaleStandings(): Promise<{ synced: number }> {
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

  const supabase = createServiceRoleSupabaseClient();
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
    return NextResponse.json({ ok: true, decision: "no_provider_configured" });
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
    return NextResponse.json({ ok: false, decision: "dedup_check_failed" }, { status: 500 });
  }

  if (heldLock) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: a ${heldLock.holder ?? "unknown"} sync run holds the fixtures lock (since ${heldLock.acquired_at}, lease until ${heldLock.expires_at}).`,
    });
    return NextResponse.json({ ok: true, decision: "already_running" });
  }

  // 4. Quota floor — same real, persisted provider_quota_remaining reading
  // Data Health's own "requests left today" pill uses (src/lib/football/last-synced.ts),
  // not a fresh provider call just to check. Unknown (null, e.g. no sync has
  // ever recorded a reading) is never treated as "low" — that would be
  // guessing, not protecting.
  const { data: latestQuotaRun } = await supabase
    .from("sync_runs")
    .select("provider_quota_remaining")
    .not("provider_quota_remaining", "is", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const quotaRemaining = latestQuotaRun?.provider_quota_remaining ?? null;

  if (quotaRemaining !== null && quotaRemaining <= QUOTA_SAFETY_FLOOR) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: provider quota too low to spend automatically (${quotaRemaining} requests remaining, safety floor is ${QUOTA_SAFETY_FLOOR}).`,
      quotaRemaining,
      // A standing condition too: the quota does not recover until the
      // provider's daily reset, so this would otherwise repeat for hours.
      suppressIfRecentPrefix: "Skipped: provider quota too low",
    });
    return NextResponse.json({ ok: true, decision: "quota_floor", quotaRemaining });
  }

  // 5. Is anything actually worth a provider call right now? The query does
  // only cheap, coarse filtering at the database level — any live/halftime
  // row, or any scheduled row kicking off by the imminent window's upper
  // bound (existing indexes on fixtures(status)/fixtures(kickoff_at), see
  // migrations 0001/0021, already cover this) — capped at 50 candidates,
  // comfortably more than this platform will ever have concurrently
  // live/imminent. The real, precise decision — including the stale-ceiling
  // lower bound that keeps a fixture the provider never flipped out of
  // 'scheduled' from looking "imminent" forever — is isFixtureWorthSyncing
  // (src/lib/football/live-worker-rules.ts), the single tested source of
  // truth for "is this fixture worth syncing," run per candidate row here
  // rather than duplicated as a second, untested raw SQL expression.
  // `imminentBy` is a server-computed ISO string, never user input, so
  // interpolating it into a raw .or() filter string is safe (contrast the
  // UUID params this codebase validates before doing the same — see
  // src/lib/params.ts and getHeadToHead's doc comment in
  // src/lib/football/head-to-head.ts).
  // The baseline run has nothing to check here: its whole job is to fetch
  // today's fixtures so that fixtures exist at all, and gating that on
  // "is one of the fixtures we do not have live right now" would mean an empty
  // database could never fill itself.
  if (mode === "daily") {
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
     */
    const standings = await syncStaleStandings();

    return NextResponse.json(
      {
        ok: dailyResult.status !== "failed",
        decision: "synced",
        mode,
        status: dailyResult.status,
        recordsProcessed: dailyResult.recordsProcessed,
        standingsSeasonsSynced: standings.synced,
        error: dailyResult.error ?? null,
      },
      { status: dailyResult.status === "failed" ? 500 : 200 },
    );
  }

  const imminentBy = new Date(Date.now() + IMMINENT_WINDOW_MINUTES * 60_000).toISOString();

  const { data: candidateFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, status, kickoff_at")
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

  const hasRelevantFixture = (candidateFixtures ?? []).some((fixture) =>
    isFixtureWorthSyncing(fixture.status, fixture.kickoff_at, {
      imminentWindowMinutes: IMMINENT_WINDOW_MINUTES,
      staleScheduledCeilingHours: STALE_SCHEDULED_CEILING_HOURS,
    }),
  );

  if (!hasRelevantFixture) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      triggerSource,
      reason: `Skipped: nothing live/halftime and nothing scheduled within ${IMMINENT_WINDOW_MINUTES} minutes.`,
      quotaRemaining,
      suppressIfRecentPrefix: "Skipped: nothing live/halftime",
    });
    return NextResponse.json({ ok: true, decision: "nothing_live" });
  }

  // Every guard passed and something is genuinely live/imminent — spend a
  // real provider call through the exact same path "Sync now" uses.
  // syncTodayFixtures writes its own sync_runs row (status running ->
  // success/partial/failed, trigger_source 'cron') — no separate logging here.
  const result = await syncTodayFixtures("cron");

  return NextResponse.json(
    {
      ok: result.status !== "failed",
      decision: "synced",
      status: result.status,
      recordsProcessed: result.recordsProcessed,
      error: result.error ?? null,
    },
    { status: result.status === "failed" ? 500 : 200 },
  );
}

