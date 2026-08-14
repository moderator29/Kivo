import "server-only";
import type { FootballDataProvider } from "./types";
import { ApiFootballProvider } from "./providers/api-football";
import { MockFootballProvider } from "./providers/mock";

/**
 * Feature flag — live polling/websocket connections must stay off until a paid
 * provider tier with real quota exists. Flip via FOOTBALL_LIVE_POLLING_ENABLED.
 * See DECISIONS.md — never let this default to true.
 */
export const FOOTBALL_LIVE_POLLING_ENABLED = process.env.FOOTBALL_LIVE_POLLING_ENABLED === "true";

let cachedProvider: FootballDataProvider | null = null;

/**
 * Single entry point for all football data access. Every consumer (routes, server
 * components, future sync jobs) goes through this — never import a concrete provider
 * class directly, so swapping or adding providers never touches calling code.
 */
export function getFootballDataProvider(): FootballDataProvider {
  if (cachedProvider) return cachedProvider;

  const apiKey = process.env.API_FOOTBALL_KEY;

  if (apiKey) {
    cachedProvider = new ApiFootballProvider(apiKey);
  } else if (process.env.NODE_ENV !== "production") {
    cachedProvider = new MockFootballProvider();
  } else {
    throw new Error(
      "No football data provider configured. Set API_FOOTBALL_KEY (see ENVIRONMENT.md). The mock provider is development-only.",
    );
  }

  return cachedProvider;
}
