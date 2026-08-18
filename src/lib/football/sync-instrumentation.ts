import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

type ServiceClient = SupabaseClient<Database>;
type EntityType = Database["public"]["Enums"]["provider_entity_type"];
type AnomalyType = Database["public"]["Enums"]["data_anomaly_type"];

/**
 * Everything the sync pipeline records *about itself* — the lease that stops
 * two runs colliding (KN-82), the per-entity failure log that makes a retry
 * targeted (KN-81), and the anomaly log that moves a detected data conflict
 * out of stdout and into the product (KN-95).
 *
 * One rule governs this whole module: **instrumentation may never fail a
 * sync.** Every function below catches its own errors and degrades to a
 * logged warning, because the alternative — a sync that successfully wrote
 * 300 fixtures then threw because it could not write a bookkeeping row — is
 * strictly worse than losing the bookkeeping. The single exception is
 * `claimSyncLock`, whose *whole purpose* is to say no; a failure to determine
 * whether somebody else is running returns null (do not run), because
 * proceeding on an unknown answer is exactly the collision the lock exists to
 * prevent.
 */

/** How long a claimed lease lives before another worker may take it over.
 *
 * Ten minutes rather than the cron route's old two-minute dedup window: a full
 * fixtures sync over a busy day is hundreds of sequential round trips, and a
 * lease that expires mid-run would let a second worker start writing on top of
 * the first — the precise failure this replaces. It is a ceiling, not an
 * expectation: the normal path releases in `finally` within seconds, and a
 * long run extends its own lease rather than sitting near the edge of it. */
export const SYNC_LEASE_SECONDS = 600;

/** Extend when the run passes this fraction of its lease. */
const RENEW_AFTER_SECONDS = SYNC_LEASE_SECONDS / 2;

export type SyncLock = {
  provider: string;
  entityType: EntityType;
  token: string;
  claimedAtMs: number;
  lastRenewedAtMs: number;
};

/**
 * Claims the (provider, entity_type) lease, or returns null when another run
 * already holds it.
 *
 * Null is also what a *failed* claim returns, and that asymmetry is
 * deliberate: "I could not find out whether another run is in flight" and
 * "another run is in flight" must lead to the same decision, which is to not
 * run. The caller records a skipped run either way, so nothing is silent.
 */
export async function claimSyncLock(
  supabase: ServiceClient,
  provider: string,
  entityType: EntityType,
  options: { holder: string; syncRunId?: string | null },
): Promise<SyncLock | null> {
  try {
    const { data, error } = await supabase.rpc("claim_sync_lock", {
      p_provider: provider,
      p_entity_type: entityType,
      p_lease_seconds: SYNC_LEASE_SECONDS,
      p_holder: options.holder,
      ...(options.syncRunId ? { p_sync_run_id: options.syncRunId } : {}),
    });

    if (error) {
      logError("sync.claimSyncLock", error, { provider, entityType });
      return null;
    }
    if (!data) return null;

    const now = Date.now();
    return { provider, entityType, token: data, claimedAtMs: now, lastRenewedAtMs: now };
  } catch (error) {
    logError("sync.claimSyncLock", error, { provider, entityType });
    return null;
  }
}

/**
 * Extends the lease if it is more than halfway through, and reports whether
 * the caller still holds it.
 *
 * Returning false means the lease was taken over by somebody else after
 * expiring, and the caller must stop writing — carrying on would be two runs
 * doing the same work, which is the thing being prevented. A network failure
 * returns true (keep going): the lease is probably still held, and abandoning
 * a run mid-way on a transient error would be a worse outcome than a slightly
 * stale lease.
 */
export async function renewSyncLockIfNeeded(supabase: ServiceClient, lock: SyncLock): Promise<boolean> {
  if (Date.now() - lock.lastRenewedAtMs < RENEW_AFTER_SECONDS * 1000) return true;

  try {
    const { data, error } = await supabase.rpc("renew_sync_lock", {
      p_provider: lock.provider,
      p_entity_type: lock.entityType,
      p_token: lock.token,
      p_lease_seconds: SYNC_LEASE_SECONDS,
    });
    if (error) {
      logError("sync.renewSyncLock", error, { provider: lock.provider, entityType: lock.entityType });
      return true;
    }
    if (data) {
      lock.lastRenewedAtMs = Date.now();
      return true;
    }
    return false;
  } catch (error) {
    logError("sync.renewSyncLock", error, { provider: lock.provider, entityType: lock.entityType });
    return true;
  }
}

/** Releases the lease. Always safe to call, including for a lease already lost
 * to expiry — the token check inside means it can only ever release its own. */
export async function releaseSyncLock(supabase: ServiceClient, lock: SyncLock): Promise<void> {
  try {
    const { error } = await supabase.rpc("release_sync_lock", {
      p_provider: lock.provider,
      p_entity_type: lock.entityType,
      p_token: lock.token,
    });
    if (error) logError("sync.releaseSyncLock", error, { provider: lock.provider, entityType: lock.entityType });
  } catch (error) {
    logError("sync.releaseSyncLock", error, { provider: lock.provider, entityType: lock.entityType });
  }
}

export type EntityFailure = {
  providerEntityId: string;
  message: string;
  /** Postgres SQLSTATE when the failure came from the database, else null. */
  code?: string | null;
  /** Human-readable identification, e.g. "Arsenal v Chelsea" — so the retry
   * list in Data Health reads like fixtures, not like uuids. */
  label?: string | null;
};

/**
 * Writes one row per failed entity (KN-81). Batched into a single insert: a
 * run that failed on 200 fixtures must not turn into 200 round trips on top of
 * the round trips that already failed.
 *
 * `ignoreDuplicates` because the table's unique key is (run, entity type,
 * provider id) — the same entity failing twice inside one run is one failure,
 * not two, and it must not be the thing that throws.
 */
export async function recordEntityFailures(
  supabase: ServiceClient,
  params: { syncRunId: string; provider: string; entityType: EntityType; failures: EntityFailure[] },
): Promise<void> {
  if (params.failures.length === 0) return;

  try {
    const rows = params.failures.map((failure) => ({
      sync_run_id: params.syncRunId,
      provider: params.provider,
      entity_type: params.entityType,
      provider_entity_id: failure.providerEntityId,
      // The column's own check constraint caps this at 2000 characters; trim
      // here so a pathological provider error message is a truncated row
      // rather than a rejected insert that loses the whole batch.
      error_message: failure.message.slice(0, 2000),
      error_code: failure.code ?? null,
      context: (failure.label ? { label: failure.label } : {}) as Json,
    }));

    const { error } = await supabase.from("sync_run_failures").upsert(rows, {
      onConflict: "sync_run_id,entity_type,provider_entity_id",
      ignoreDuplicates: true,
    });
    if (error) logError("sync.recordEntityFailures", error, { syncRunId: params.syncRunId });
  } catch (error) {
    logError("sync.recordEntityFailures", error, { syncRunId: params.syncRunId });
  }
}

/**
 * Closes open failures for entities this run actually processed (KN-81).
 *
 * "Resolved" therefore always means a later run genuinely succeeded on that
 * same provider entity — never "enough time passed", never "the run overall
 * looked fine". A failure nobody has fixed stays open and keeps showing up.
 */
export async function resolveEntityFailures(
  supabase: ServiceClient,
  params: { provider: string; entityType: EntityType; providerEntityIds: string[] },
): Promise<void> {
  if (params.providerEntityIds.length === 0) return;

  try {
    const { error } = await supabase.rpc("resolve_sync_run_failures", {
      p_provider: params.provider,
      p_entity_type: params.entityType,
      p_provider_entity_ids: params.providerEntityIds,
    });
    if (error) logError("sync.resolveEntityFailures", error, { provider: params.provider });
  } catch (error) {
    logError("sync.resolveEntityFailures", error, { provider: params.provider });
  }
}

/**
 * Persists a detected data conflict (KN-95).
 *
 * The pipeline already *found* these — a score going backwards, a finished
 * fixture un-finishing — and wrote them to `console.warn`, where they are
 * invisible to everyone who is not tailing a server log. This is the same
 * detection, kept, plus a row an admin can actually see. The console line
 * stays too: it is what a developer watching a sync in real time reads.
 *
 * Never blocks the write that triggered it. A conflict is a signal to a human,
 * not grounds for KIVO to start deciding which of two provider readings is
 * true — that judgement needs a second source, which does not exist yet.
 */
export async function recordAnomaly(
  supabase: ServiceClient,
  params: {
    anomalyType: AnomalyType;
    provider: string;
    entityType: EntityType;
    detail: string;
    syncRunId?: string | null;
    providerEntityId?: string | null;
    kivoEntityId?: string | null;
    previousValue?: Json | null;
    newValue?: Json | null;
  },
): Promise<void> {
  try {
    const { error } = await supabase.rpc("record_data_anomaly", {
      p_anomaly_type: params.anomalyType,
      p_provider: params.provider,
      p_entity_type: params.entityType,
      p_detail: params.detail,
      ...(params.syncRunId ? { p_sync_run_id: params.syncRunId } : {}),
      ...(params.providerEntityId ? { p_provider_entity_id: params.providerEntityId } : {}),
      ...(params.kivoEntityId ? { p_kivo_entity_id: params.kivoEntityId } : {}),
      ...(params.previousValue !== undefined && params.previousValue !== null
        ? { p_previous_value: params.previousValue }
        : {}),
      ...(params.newValue !== undefined && params.newValue !== null ? { p_new_value: params.newValue } : {}),
    });
    if (error) logError("sync.recordAnomaly", error, { anomalyType: params.anomalyType });
  } catch (error) {
    logError("sync.recordAnomaly", error, { anomalyType: params.anomalyType });
  }
}

/**
 * Marks fixtures as seen in this run's provider response, and clears any
 * absence flag they were carrying (KN-86) — a fixture that comes back is no
 * longer absent, and nobody should have to clear that by hand.
 */
export async function markFixturesSeen(supabase: ServiceClient, fixtureIds: string[]): Promise<void> {
  if (fixtureIds.length === 0) return;

  try {
    const { error } = await supabase
      .from("fixtures")
      .update({ provider_last_seen_at: new Date().toISOString(), absence_flagged_at: null })
      .in("id", fixtureIds);
    if (error) logError("sync.markFixturesSeen", error, { count: fixtureIds.length });
  } catch (error) {
    logError("sync.markFixturesSeen", error, { count: fixtureIds.length });
  }
}

/**
 * Flags fixtures inside the window this run actually covered that the provider
 * did not report (KN-86). Returns how many were newly flagged.
 *
 * Flags, never deletes, and only ever for fixtures previously *seen* by this
 * same provider — absence from a single response is a question, not a verdict.
 */
export async function flagAbsentFixtures(
  supabase: ServiceClient,
  params: { provider: string; runStartedAt: string; kickoffFrom: string; kickoffTo: string },
): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("flag_absent_fixtures", {
      p_provider: params.provider,
      p_run_started_at: params.runStartedAt,
      p_kickoff_from: params.kickoffFrom,
      p_kickoff_to: params.kickoffTo,
    });
    if (error) {
      logError("sync.flagAbsentFixtures", error, { provider: params.provider });
      return 0;
    }
    return data ?? 0;
  } catch (error) {
    logError("sync.flagAbsentFixtures", error, { provider: params.provider });
    return 0;
  }
}
