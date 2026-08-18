import "server-only";
import { NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { FOOTBALL_LIVE_POLLING_ENABLED, getActiveProviderStatus } from "@/lib/football";
import { syncTodayFixtures } from "@/lib/football/sync";
import { isAuthorizedCronRequest, isFixtureWorthSyncing } from "@/lib/football/live-worker-rules";
import { logError } from "@/lib/log";

/**
 * The real, automated live-sync worker (founder directive, 2026-08-18) — the
 * piece docs/LIVE_DATA.md's checklist has always flagged as "NOT BUILT". Wired
 * to Vercel Cron via the `crons` array in vercel.json, path `/api/cron/sync-live`,
 * schedule `* * * * *` (once a minute — Vercel Cron's documented minimum
 * interval; https://vercel.com/docs/cron-jobs shows this exact "every minute"
 * expression as a supported schedule, though whether the account this project
 * deploys to is on a Vercel plan that actually permits sub-daily cron
 * frequency is not something this sandbox can check — see docs/LIVE_DATA.md).
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
async function logSkippedRun(
  supabase: ServiceClient,
  params: { provider: string; reason: string; quotaRemaining?: number | null },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("sync_runs").insert({
    provider: params.provider,
    entity_type: "fixture",
    status: "skipped",
    trigger_source: "cron",
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

export async function GET(request: Request) {
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

  const supabase = createServiceRoleSupabaseClient();
  // Sync, side-effect-free — never constructs a provider client or spends
  // quota just to label a log row (see its doc comment in src/lib/football/index.ts).
  const { name: activeProviderName } = getActiveProviderStatus();
  const providerLabel = activeProviderName ?? "unconfigured";

  // 1. The real gate. Never flip this from code — see FOOTBALL_LIVE_POLLING_ENABLED's
  // own doc comment.
  if (!FOOTBALL_LIVE_POLLING_ENABLED) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      reason: "Skipped: FOOTBALL_LIVE_POLLING_ENABLED is false.",
    });
    return NextResponse.json({ ok: true, decision: "polling_disabled" });
  }

  // 2. Mirrors requireFootballDataAccess in admin/data-health/actions.ts — never
  // run against nothing (or silently fall through to the dev-only mock
  // provider) just because a cron fired against a not-yet-configured deploy.
  if (!process.env.API_FOOTBALL_KEY) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
      reason: "Skipped: no real football data provider is configured (API_FOOTBALL_KEY unset).",
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
      reason: `Skipped: dedup check failed, refusing to risk a concurrent run (${dedupError.message}).`,
    });
    return NextResponse.json({ ok: false, decision: "dedup_check_failed" }, { status: 500 });
  }

  if (heldLock) {
    await logSkippedRun(supabase, {
      provider: providerLabel,
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
      reason: `Skipped: provider quota too low to spend automatically (${quotaRemaining} requests remaining, safety floor is ${QUOTA_SAFETY_FLOOR}).`,
      quotaRemaining,
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
      reason: `Skipped: nothing live/halftime and nothing scheduled within ${IMMINENT_WINDOW_MINUTES} minutes.`,
      quotaRemaining,
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
