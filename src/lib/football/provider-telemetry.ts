import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";
import { redactProviderSecrets, type ProviderRequestOutcome } from "./providers/provider-request";

type ServiceClient = SupabaseClient<Database>;

/**
 * Writes what actually happened on a provider request into
 * `provider_request_log`.
 *
 * -----------------------------------------------------------------------------
 * WHY THIS EXISTS WHEN `sync_runs` ALREADY DOES
 * -----------------------------------------------------------------------------
 * `sync_runs` records a JOB. One row covers hundreds of round trips, carries one
 * error message and no timing at all, and does not exist for a request made
 * outside a sync — which, once the cache above it starts refreshing things on
 * demand, is most of them. Asked "what is this provider's latency", the honest
 * answer from `sync_runs` alone is that nobody knows.
 *
 * That is the answer this file makes it possible to stop giving. Not by
 * estimating one — by measuring it, once per request, and storing null when
 * nothing measured it.
 *
 * -----------------------------------------------------------------------------
 * WHY TELEMETRY MUST NEVER THROW
 * -----------------------------------------------------------------------------
 * Every function here swallows its own failure and logs it. A provider request
 * that succeeded and then failed to be *recorded* has still succeeded, and
 * turning a monitoring problem into a football problem inverts the entire point
 * of monitoring. The cost is that a broken log goes quiet rather than loud —
 * accepted, and mitigated by the Admin page showing when the last row of any
 * kind was written, so silence is visible.
 */

/**
 * Records one provider request.
 *
 * Deliberately takes the outcome shape `provider-request.ts` already produces,
 * so an adapter wires telemetry by passing this through as `onOutcome` rather
 * than by assembling a second description of the same event.
 */
export async function recordProviderRequest(
  supabase: ServiceClient,
  outcome: ProviderRequestOutcome,
  extra: { cacheState?: string | null; secrets?: readonly (string | undefined | null)[] } = {},
): Promise<void> {
  try {
    const { error } = await supabase.from("provider_request_log").insert({
      provider: outcome.provider,
      resource_class: outcome.resourceClass,
      outcome: outcome.outcome,
      // The table refuses an error row without a kind, so this is belt to the
      // constraint's braces rather than a second opinion about it.
      error_kind: outcome.outcome === "error" ? (outcome.kind ?? "client_error") : outcome.kind,
      http_status: outcome.status,
      // Null stays null. An unmeasured latency renders as unknown on the Admin
      // page, and coercing it to 0 here would make an outage look instant.
      latency_ms: outcome.latencyMs,
      quota_remaining: outcome.quotaRemaining,
      cache_state: extra.cacheState ?? null,
      attempts: outcome.attempts,
      // Redacted here as well as at the point the message was built. The message
      // should already be clean; this is the layer that guarantees a credential
      // cannot be at rest in a table an admin page reads, even for the length of
      // one bad code path.
      message: outcome.message === null ? null : redactProviderSecrets(outcome.message, extra.secrets ?? []).slice(0, 2_000),
    });
    if (error) logError("football.providerTelemetry.insert", error, { provider: outcome.provider });
  } catch (err) {
    logError("football.providerTelemetry.insert", err, { provider: outcome.provider });
  }
}

/**
 * An `onOutcome` sink bound to one Supabase client, for handing straight to
 * `requestProvider`.
 *
 * Returns a fire-and-forget function on purpose: the transport awaits it, but
 * this never rejects, so a slow or broken log adds latency at worst and can
 * never fail a football request.
 */
export function providerTelemetrySink(
  supabase: ServiceClient,
  options: { cacheState?: string | null; secrets?: readonly (string | undefined | null)[] } = {},
): (outcome: ProviderRequestOutcome) => Promise<void> {
  return (outcome) => recordProviderRequest(supabase, outcome, options);
}

/** Bounded retention sweep, for the janitor step alongside the other two. */
export async function pruneProviderRequestLog(supabase: ServiceClient): Promise<number> {
  const { data, error } = await supabase.rpc("prune_provider_request_log", { p_max_rows: 5000 });
  if (error) {
    logError("football.providerTelemetry.prune", error);
    return 0;
  }
  return typeof data === "number" ? data : 0;
}
