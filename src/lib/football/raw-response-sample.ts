/**
 * RECOMMENDATIONS.md item 65: a bounded, admin-diagnosable sample of the last
 * raw response a provider adapter actually received — not the full payload
 * (a day's `/fixtures?date=` response can be hundreds of fixtures; storing
 * that unbounded on every sync_runs row would make the table grow without
 * limit for zero real diagnostic benefit past the first few KB). Capped at
 * `RAW_RESPONSE_SAMPLE_MAX_CHARS` characters of the JSON-stringified body —
 * enough to see real field names/shapes/error payloads when a normalizer
 * misclassifies something, not enough to matter for storage growth. The DB
 * column (`sync_runs.raw_response_sample`, migration 0041) also enforces this
 * cap via a check constraint as defense in depth, not just app-layer trust.
 */
export const RAW_RESPONSE_SAMPLE_MAX_CHARS = 20_000;

export type RawResponseSample = {
  path: string;
  /** Null when the provider adapter's own request helper doesn't surface a
   * status code back to the caller on the success path (see
   * TheSportsDbProvider's usage) — honestly absent, never guessed at (a REST
   * JSON endpoint succeeding is *usually* a 200, but "usually" is not a fact
   * this file will assert). Always populated on a failure, since the thrown
   * error carries the real status either way. */
  status: number | null;
  capturedAt: string;
  /** True when `bodySample` was cut short of the real response — never
   * silently pretend a truncated sample is the whole thing. */
  truncated: boolean;
  bodySample: string;
};

export function buildRawResponseSample(path: string, status: number | null, body: unknown): RawResponseSample {
  let full: string;
  try {
    full = JSON.stringify(body) ?? String(body);
  } catch {
    full = String(body);
  }
  const truncated = full.length > RAW_RESPONSE_SAMPLE_MAX_CHARS;
  return {
    path,
    status,
    capturedAt: new Date().toISOString(),
    truncated,
    bodySample: truncated ? full.slice(0, RAW_RESPONSE_SAMPLE_MAX_CHARS) : full,
  };
}
