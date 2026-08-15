/**
 * Caps a per-item stagger reveal delay to the first `limit` items (default
 * 6) so a long list's later rows don't wait longer and longer to appear —
 * past the cap, every item gets zero *added* delay instead of being frozen
 * at the same max delay as item `limit`. Any constant base offset a caller
 * layers on top (e.g. `0.1 + staggerDelay(index, 0.03)`) still applies to
 * every item, capped or not. See RECOMMENDATIONS.md #77.
 */
export function staggerDelay(index: number, step: number, limit = 6): number {
  return index < limit ? index * step : 0;
}
