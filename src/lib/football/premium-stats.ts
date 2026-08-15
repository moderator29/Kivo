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
  throw new Error("Premium stats provider is configured but not implemented yet.");
}
