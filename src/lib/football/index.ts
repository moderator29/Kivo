import "server-only";
import type { FootballDataProvider } from "./types";
import { ApiFootballProvider } from "./providers/api-football";

/**
 * Feature flag — live polling/websocket connections must stay off until a paid
 * provider tier with real quota exists. Flip via FOOTBALL_LIVE_POLLING_ENABLED.
 * See DECISIONS.md — never let this default to true.
 *
 * RECOMMENDATIONS.md item 51: this now actually guards something —
 * triggerLiveScoresRefresh (src/app/admin/data-health/actions.ts), the manual
 * "Refresh live scores" action on /live, checks it before spending any provider
 * quota. It's still never a timer/poll of any kind on this free tier: the guard
 * exists so the *manual* action stays a deliberate, admin-triggered no-op until
 * a paid tier makes the flag worth flipping, not so it can be automated later
 * without re-reading this comment.
 */
export const FOOTBALL_LIVE_POLLING_ENABLED = process.env.FOOTBALL_LIVE_POLLING_ENABLED === "true";

let cachedProvider: FootballDataProvider | null = null;

/**
 * Single entry point for all football data access. Every consumer (routes, server
 * components, future sync jobs) goes through this — never import a concrete provider
 * class directly, so swapping or adding providers never touches calling code.
 *
 * Async (rather than a plain sync lookup) specifically so the mock provider import
 * below can be dynamic: it's a server-only module so it never reached the browser,
 * but a static top-level import still pulled its dev-only Nigerian-league mock
 * fixtures/squads into every production server bundle that imports this file. Gating
 * it behind NODE_ENV + a dynamic import keeps it out of a production build entirely
 * (RECOMMENDATIONS.md item 63) instead of just being unreachable at runtime.
 */
export async function getFootballDataProvider(): Promise<FootballDataProvider> {
  if (cachedProvider) return cachedProvider;

  const apiKey = process.env.API_FOOTBALL_KEY;

  if (apiKey) {
    cachedProvider = new ApiFootballProvider(apiKey);
  } else if (process.env.NODE_ENV !== "production") {
    const { MockFootballProvider } = await import("./providers/mock");
    cachedProvider = new MockFootballProvider();
  } else {
    throw new Error(
      "No football data provider configured. Set API_FOOTBALL_KEY (see ENVIRONMENT.md). The mock provider is development-only.",
    );
  }

  return cachedProvider;
}
