import "server-only";

/**
 * Seam for a second, premium football-data provider — market value, contract
 * expiry, and per-player pitch heat maps, none of which API-Football's free
 * tier reports (see FootballDataProvider.getSquad's doc comment in ./types.ts).
 *
 * This is intentionally NOT wired into `getFootballDataProvider()` in
 * ./index.ts and NOT added to the `FootballDataProvider` interface itself —
 * those fields aren't ones every provider (including MockFootballProvider)
 * should be forced to implement, and there's no vendor account to call yet.
 * This file exists purely so the plug point is visible and typed ahead of
 * time. See supabase/migrations/0036_premium_stats_readiness.sql for the
 * columns this would eventually populate, DECISIONS.md for the research
 * behind the vendor choice, and RECOMMENDATIONS.md item 179's follow-up for
 * why market value was previously ruled out and what's changed.
 *
 * Mirrors the isAiConfigured() / getAnthropicClient() pattern in
 * src/lib/ai/client.ts: a boolean gate the caller checks first, and an
 * accessor that throws if called without checking it.
 */

/**
 * True once a premium stats vendor's credentials are actually present.
 * Sportmonks (sportmonks.com) is the researched candidate — plans from
 * €29/mo Starter up to €249/mo Pro — but market-value and heatmap endpoint
 * availability at any given tier is UNCONFIRMED as of this writing; contract
 * expiry is more plausible via their `transfers`/`pendingTransfers` player
 * data but is also unconfirmed. Nothing here assumes either is real until an
 * actual account is bought and the response shape is verified against it.
 *
 * Reads SPORTMONKS_API_TOKEN, already documented as reserved-but-unread in
 * ENVIRONMENT.md (RECOMMENDATIONS.md item 220) — this is the function that
 * will make it read once a token exists.
 */
export function isPremiumStatsConfigured(): boolean {
  return Boolean(process.env.SPORTMONKS_API_TOKEN);
}

/** A single vendor-reported market valuation for one player. */
export interface PremiumPlayerMarketValue {
  /** Whole euros. Never estimated — only ever a value the vendor itself reported. */
  valueEur: number;
  /** When the vendor last refreshed this figure. */
  asOf: string;
  /** Real vendor-reported contract expiry, or null if the vendor has none on file. */
  contractExpiresAt: string | null;
}

/**
 * Touch-count zone grid for one player in one match — same shape documented
 * on lineups.pitch_heatmap in supabase/migrations/0036_premium_stats_readiness.sql.
 * Approximate/derived activity zones, not authoritative per-touch coordinates,
 * unless a vendor that actually provides per-touch data (Opta/StatsBomb/Wyscout
 * tier) is one day connected instead — see DECISIONS.md for that distinction.
 */
export interface PremiumPlayerHeatmap {
  grid: { cols: number; rows: number };
  zones: number[][];
  source: string;
  retrievedAt: string;
}

/**
 * Typed seam for the premium-stats vendor call. Not implemented — throws
 * until a real vendor integration exists. Callers must check
 * isPremiumStatsConfigured() first, exactly like getAnthropicClient().
 */
export interface PremiumStatsProvider {
  getPlayerMarketValue(playerProviderId: string): Promise<PremiumPlayerMarketValue | null>;
  getPlayerHeatmap(playerProviderId: string, fixtureProviderId: string): Promise<PremiumPlayerHeatmap | null>;
}

/**
 * Stub implementation. Every method throws — there is no HTTP client here,
 * no vendor SDK, no request signing, because there is no API key to build
 * one against yet. This exists only so calling code can be written and typed
 * against the eventual real thing without anyone being tempted to fill the
 * gap with fabricated numbers in the meantime.
 */
export function getPremiumStatsProvider(): PremiumStatsProvider {
  if (!isPremiumStatsConfigured()) {
    throw new Error(
      "No premium stats provider configured. Set SPORTMONKS_API_TOKEN (see ENVIRONMENT.md) once a vendor account exists. Check isPremiumStatsConfigured() before calling this.",
    );
  }
  // Reachable only once SPORTMONKS_API_TOKEN is set — which nothing sets today.
  // Implementing this is the actual vendor-integration work, deliberately not
  // done here: confirm the real Sportmonks response shape for market value /
  // contract data first (see the "unconfirmed" notes above), then implement
  // against that, rather than guessing at a shape now.
  //
  // ---- Scoped follow-up plan (NOT verified against a live Sportmonks account —
  // confirm every path/include/field below against a real response before writing
  // the fetch client, exactly like providers/api-football.ts's request layer does) ----
  //
  // Sportmonks' v3 football API (docs.sportmonks.com/football) is REST, auth via an
  // `api_token` query param (not a header, unlike API-Football's `x-apisports-key`) —
  // e.g. `?api_token=${token}`. Base URL: https://api.sportmonks.com/v3/football.
  // Responses are wrapped in a top-level `data` key (single object or array
  // depending on endpoint), plus `pagination`/`rate_limit` metadata siblings —
  // shape presumably mirrors API-Football's response envelope closely enough that
  // requestWithRetry's retry/429-vs-4xx/quota-header split in
  // ./providers/api-football-request.ts can likely be generalized and reused rather
  // than rewritten, once the real rate-limit header name is confirmed (Sportmonks
  // docs reference `X-RateLimit-Remaining`-style headers, not yet confirmed exact).
  //
  // Player lookup + market value (getPlayerMarketValue):
  //   GET /v3/football/players/{sportmonksPlayerId}?api_token=...&include=...
  //   Sportmonks' player resource itself is the base; specific stat/value data is
  //   pulled in via the `include` query param, not separate endpoints — mirrors
  //   how API-Football nests `statistics` on `/players?id=`. Candidate includes to
  //   check against a real account: `include=statistics` (season aggregates),
  //   `include=transfers` (see below). NO include is confirmed to expose a market
  //   value field as of this writing (DECISIONS.md's "unconfirmed" caveat still
  //   holds) — Sportmonks markets an "Advanced Plan" / player valuation add-on for
  //   some competitions; verify field name (likely something like
  //   `player.market_value` or a dedicated `include=values`/valuations resource)
  //   against the live docs/account before assuming this endpoint covers
  //   PremiumPlayerMarketValue.valueEur at all. If it doesn't, this field may need
  //   a different vendor than Sportmonks — don't force it.
  //
  // Contract expiry (also part of getPlayerMarketValue's return):
  //   Same `/v3/football/players/{id}` resource, `include=transfers` (transfer
  //   history, most plausible source of a "moved in on contract until X" date) or
  //   a teams-endpoint include exposing squad contract data — Sportmonks'
  //   `pendingTransfers`/`transfers` includes are the most-referenced public path
  //   for this per the DECISIONS.md research; confirm the actual field name
  //   (candidate: a `contract_end` or similar date field on the transfer/squad
  //   payload) before mapping it to PremiumPlayerMarketValue.contractExpiresAt.
  //
  // Heatmap (getPlayerHeatmap):
  //   No dedicated Sportmonks heatmap endpoint is documented publicly (see
  //   DECISIONS.md's heat-maps rationale) — the closest available data is
  //   fixture/player event or ball-position data via
  //   `GET /v3/football/fixtures/{fixtureId}?include=events` or a dedicated
  //   lineups/statistics include, which would have to be bucketed into the
  //   {cols, rows, zones} grid shape client-side (i.e. any heatmap built from
  //   Sportmonks data is DERIVED/approximate, never authoritative per-touch data
  //   — must be labelled as such in the UI, per DECISIONS.md). If Sportmonks
  //   truly has no position-level data at any accessible tier, this method should
  //   stay unimplemented (return null, not fabricate a grid) until a
  //   StatsBomb/Wyscout-tier vendor is connected instead.
  //
  // Auth/request client: model it on ./providers/api-football-request.ts's
  // classify/retry split (network vs 4xx vs 5xx vs rate-limited), swapping the
  // key transport to a query param and re-deriving the quota-header name from a
  // real response before reusing parseQuotaRemaining's parsing logic verbatim.
  throw new Error("Premium stats provider is configured but not implemented yet.");
}
