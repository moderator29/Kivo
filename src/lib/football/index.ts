import { logError } from "@/lib/log";
import "server-only";
import type { FootballDataProvider } from "./types";
import { ApiFootballProvider } from "./providers/api-football";
import { TheSportsDbProvider } from "./providers/thesportsdb";

/**
 * Feature flag — live polling must stay off until a paid provider tier with
 * real quota exists. Flip via FOOTBALL_LIVE_POLLING_ENABLED. See DECISIONS.md
 * — never flip this to true from code; only the founder flips it, in Vercel,
 * once they've decided the account can absorb the request volume.
 *
 * RECOMMENDATIONS.md item 51: this guards two call sites today —
 * triggerLiveScoresRefresh (src/app/admin/data-health/actions.ts), the manual
 * "Refresh live scores" action on /live, and (2026-08-18) the real Vercel Cron
 * worker at src/app/api/cron/sync-live/route.ts. The worker itself is now
 * genuinely automated infrastructure — Vercel invokes that route on a fixed
 * one-minute schedule regardless of this flag — but this flag is the very
 * first thing the route checks, and while it's false (the default) every one
 * of those invocations is a same-millisecond no-op that never reaches
 * getFootballDataProvider() or spends a single unit of provider quota; it
 * only logs a `sync_runs` row saying it skipped. So "there is now a cron job"
 * and "this flag being false means zero automated provider calls happen" are
 * both true at once — the flag's job was always to gate *spending quota*, not
 * to prevent a schedule from existing, and it still does exactly that.
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
/**
 * Config-selectable provider choice (2026-08-15 directive, part 2 of the
 * Sportmonks-removal/TheSportsDB pass — see DECISIONS.md). `FOOTBALL_DATA_PROVIDER`
 * defaults to `"api-football"` — API-Football stays the primary provider per the
 * founder's own standing directive; TheSportsDB is additive/future-optional, not
 * a replacement. An unrecognized value falls back to the default rather than
 * failing the build, same "degrade, don't crash" posture as every other optional
 * env var in this file.
 *
 * A single env-var switch (rather than e.g. automatic fallback/failover between
 * providers) was a deliberate judgment call: this codebase has no multi-provider
 * merge/reconciliation logic anywhere (provider_mappings is keyed per-provider,
 * not "best available"), and building real failover would mean deciding how to
 * reconcile two providers' IDs for the same real-world entity — a genuinely
 * separate, larger feature, not a scope this pass should absorb. A plain switch
 * is honest about what actually exists today: one active provider at a time,
 * chosen deliberately, not two racing each other.
 */
function resolveProviderChoice(): "api-football" | "thesportsdb" {
  return process.env.FOOTBALL_DATA_PROVIDER === "thesportsdb" ? "thesportsdb" : "api-football";
}

export type ActiveProviderName = "api-football" | "thesportsdb" | null;

/**
 * Synchronous, side-effect-free mirror of getFootballDataProvider()'s own
 * selection order below — env vars only, never constructs a provider client
 * or spends any quota. Exists so admin pages (Overview's stat card, Data
 * Health's status banner) can show "which provider is actually configured"
 * without duplicating this logic in two places and risking them drifting
 * apart. The mock provider is dev-only and never counts as "connected" here,
 * matching the platform's zero-fake-data rule.
 */
export function getActiveProviderStatus(): { name: ActiveProviderName; label: string | null } {
  const name: ActiveProviderName =
    process.env.FOOTBALL_DATA_PROVIDER === "thesportsdb" && process.env.THE_SPORTS_DB_API_KEY
      ? "thesportsdb"
      : process.env.API_FOOTBALL_KEY
        ? "api-football"
        : null;
  return { name, label: name === "thesportsdb" ? "TheSportsDB" : name === "api-football" ? "API-Football" : null };
}

export async function getFootballDataProvider(): Promise<FootballDataProvider> {
  if (cachedProvider) return cachedProvider;

  const providerChoice = resolveProviderChoice();
  const apiFootballKey = process.env.API_FOOTBALL_KEY;
  const theSportsDbKey = process.env.THE_SPORTS_DB_API_KEY;

  if (providerChoice === "thesportsdb" && theSportsDbKey) {
    cachedProvider = new TheSportsDbProvider(theSportsDbKey);
  } else if (apiFootballKey) {
    if (providerChoice === "thesportsdb") {
      // Requested but not configured — fail loud in the server log rather than
      // silently serving API-Football data under a "TheSportsDB" expectation.
      logError("football.dataProviderThesportsdbBut", "FOOTBALL_DATA_PROVIDER=thesportsdb but THE_SPORTS_DB_API_KEY is unset — falling back to API-Football.");
    }
    cachedProvider = new ApiFootballProvider(apiFootballKey);
  } else if (process.env.NODE_ENV !== "production") {
    const { MockFootballProvider } = await import("./providers/mock");
    cachedProvider = new MockFootballProvider();
  } else {
    throw new Error(
      "No football data provider configured. Set API_FOOTBALL_KEY, or THE_SPORTS_DB_API_KEY plus FOOTBALL_DATA_PROVIDER=thesportsdb (see ENVIRONMENT.md). The mock provider is development-only.",
    );
  }

  return cachedProvider;
}
