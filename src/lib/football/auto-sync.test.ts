import { describe, expect, it, vi } from "vitest";
import {
  AUTO_SYNC_COOLDOWN_MINUTES,
  AUTO_SYNC_STALENESS_MINUTES,
  runAutoSyncIfStale,
} from "./auto-sync";

/**
 * The guard ladder is what protects a 100-request-a-day free tier from a
 * mechanism that fires on page views. "We reasoned about it carefully" is a
 * weaker guarantee than a test that a *failing* sync is not retried by every
 * single visitor — which is the one that would actually cost the founder his
 * whole daily budget in about a minute.
 *
 * The Supabase client is faked rather than mocked at module level: each query
 * this module makes ends in `.maybeSingle()`, so a tiny recorder that returns a
 * queued result per call is enough, and it keeps the test about the decisions
 * rather than about supabase-js.
 */
const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

type Row = Record<string, unknown> | null;

/** Returns a chainable stub whose `maybeSingle()` resolves to the next queued row. */
function fakeSupabase(rowsByTable: { sync_runs: Row[]; sync_locks: Row }) {
  const syncRuns = [...rowsByTable.sync_runs];
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      for (const method of ["select", "eq", "in", "not", "order", "limit", "gt", "gte"]) {
        chain[method] = passthrough;
      }
      chain.maybeSingle = async () => ({
        data: table === "sync_locks" ? rowsByTable.sync_locks : (syncRuns.shift() ?? null),
        error: null,
      });
      return chain;
    },
  } as never;
}

function deps(overrides: {
  lastSuccessMinutesAgo?: number | null;
  lastAttemptMinutesAgo?: number | null;
  lockHeld?: boolean;
  quotaRemaining?: number | null;
  syncFixtures?: () => Promise<{ recordsProcessed: number }>;
}) {
  const {
    lastSuccessMinutesAgo = null,
    lastAttemptMinutesAgo = null,
    lockHeld = false,
    quotaRemaining = null,
  } = overrides;

  return {
    providerName: "api-football",
    now: NOW,
    syncFixtures: overrides.syncFixtures ?? vi.fn(async () => ({ recordsProcessed: 7 })),
    supabase: fakeSupabase({
      // Order matters and mirrors the module: freshness, cooldown, then quota.
      // The lock lookup reads from its own table.
      sync_runs: [
        lastSuccessMinutesAgo === null ? null : { last_synced_at: minutesAgo(lastSuccessMinutesAgo) },
        lastAttemptMinutesAgo === null ? null : { started_at: minutesAgo(lastAttemptMinutesAgo) },
        quotaRemaining === null ? null : { provider_quota_remaining: quotaRemaining },
      ],
      sync_locks: lockHeld ? { provider: "api-football" } : null,
    }),
  };
}

describe("runAutoSyncIfStale", () => {
  it("does nothing when no provider is configured — and never touches the database to find out", async () => {
    const supabase = { from: () => { throw new Error("should not be queried"); } } as never;
    await expect(runAutoSyncIfStale("matches", { providerName: null, supabase })).resolves.toEqual({
      decision: "no_provider",
    });
  });

  it("syncs an empty database, where no sync has ever succeeded", async () => {
    const syncFixtures = vi.fn(async () => ({ recordsProcessed: 12 }));
    // This is the case the whole mechanism exists for: nothing has ever run, so
    // "how stale is it" has no answer and must not be read as "fresh".
    const result = await runAutoSyncIfStale("matches", deps({ syncFixtures }));
    expect(result).toEqual({ decision: "synced", recordsProcessed: 12 });
    expect(syncFixtures).toHaveBeenCalledOnce();
  });

  it("leaves fresh data alone", async () => {
    const syncFixtures = vi.fn(async () => ({ recordsProcessed: 0 }));
    const result = await runAutoSyncIfStale(
      "matches",
      deps({ lastSuccessMinutesAgo: 2, lastAttemptMinutesAgo: 60, syncFixtures }),
    );
    expect(result).toMatchObject({ decision: "fresh" });
    expect(syncFixtures).not.toHaveBeenCalled();
  });

  it("uses a tighter threshold for /live than for /matches", async () => {
    // Ten minutes old: stale for /live, still fresh for /matches. Same data,
    // different answer, which is the point of having per-surface thresholds.
    const stale = { lastSuccessMinutesAgo: 10, lastAttemptMinutesAgo: 60 };
    expect(await runAutoSyncIfStale("live", deps(stale))).toMatchObject({ decision: "synced" });
    expect(await runAutoSyncIfStale("matches", deps(stale))).toMatchObject({ decision: "fresh" });
    expect(AUTO_SYNC_STALENESS_MINUTES.live).toBeLessThan(AUTO_SYNC_STALENESS_MINUTES.matches);
    expect(AUTO_SYNC_STALENESS_MINUTES.matches).toBeLessThan(AUTO_SYNC_STALENESS_MINUTES.browse);
  });

  it("does not retry a just-failed sync on the next page view — the guard that protects the daily quota", async () => {
    const syncFixtures = vi.fn(async () => ({ recordsProcessed: 0 }));
    // A failed run left the data exactly as stale as it found it (no success
    // ever recorded), so the staleness threshold alone would say "go" on every
    // single page view. The cooldown counts attempts, not successes.
    const result = await runAutoSyncIfStale(
      "live",
      deps({ lastSuccessMinutesAgo: null, lastAttemptMinutesAgo: 1, syncFixtures }),
    );
    expect(result).toEqual({ decision: "cooling_down" });
    expect(syncFixtures).not.toHaveBeenCalled();
    expect(AUTO_SYNC_COOLDOWN_MINUTES).toBeGreaterThan(0);
  });

  it("stands down while another run holds the sync lease", async () => {
    const syncFixtures = vi.fn(async () => ({ recordsProcessed: 0 }));
    const result = await runAutoSyncIfStale(
      "live",
      deps({ lastSuccessMinutesAgo: 600, lastAttemptMinutesAgo: 600, lockHeld: true, syncFixtures }),
    );
    expect(result).toEqual({ decision: "already_running" });
    expect(syncFixtures).not.toHaveBeenCalled();
  });

  it("stops spending when the provider's remaining quota reaches the floor", async () => {
    const syncFixtures = vi.fn(async () => ({ recordsProcessed: 0 }));
    const result = await runAutoSyncIfStale(
      "live",
      deps({ lastSuccessMinutesAgo: 600, lastAttemptMinutesAgo: 600, quotaRemaining: 10, syncFixtures }),
    );
    expect(result).toEqual({ decision: "quota_floor", quotaRemaining: 10 });
    expect(syncFixtures).not.toHaveBeenCalled();
  });

  it("treats an unknown quota as unknown, not as low", async () => {
    // Never guessing is the standing rule. A null remaining count means the
    // provider has not told us, which must not read as "nearly out".
    const result = await runAutoSyncIfStale(
      "live",
      deps({ lastSuccessMinutesAgo: 600, lastAttemptMinutesAgo: 600, quotaRemaining: null }),
    );
    expect(result).toMatchObject({ decision: "synced" });
  });

  it("degrades to no-op when the service-role client is unavailable", async () => {
    await expect(
      runAutoSyncIfStale("matches", { providerName: "api-football", supabase: null }),
    ).resolves.toEqual({ decision: "unavailable" });
  });
});
