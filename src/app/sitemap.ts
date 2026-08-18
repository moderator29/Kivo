import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// `||`, not `??` — see the root layout's metadataBase (src/app/layout.tsx)
// for why: an unset-but-declared env var can be "" rather than undefined.
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

type ChangeFrequency = MetadataRoute.Sitemap[number]["changeFrequency"];

// Static, guest-viewable routes only — the same allow list as robots.ts.
// No lastModified here: none of these correspond to a single real record
// with an updated_at, so a timestamp would just be invented.
const STATIC_ROUTES: { path: string; changeFrequency: ChangeFrequency; priority: number }[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/home", changeFrequency: "daily", priority: 0.9 },
  { path: "/matches", changeFrequency: "hourly", priority: 0.9 },
  { path: "/live", changeFrequency: "always", priority: 0.8 },
  { path: "/teams", changeFrequency: "weekly", priority: 0.7 },
  { path: "/players", changeFrequency: "weekly", priority: 0.7 },
  { path: "/leagues", changeFrequency: "weekly", priority: 0.7 },
  { path: "/discover", changeFrequency: "weekly", priority: 0.6 },
  { path: "/transfers", changeFrequency: "daily", priority: 0.6 },
];

// Reasonable upper bounds so a growing football dataset can never turn this
// into an unbounded query. Competitions are naturally far fewer than teams
// or players (leagues, not individual entities), hence the smaller cap.
const TEAM_LIMIT = 5000;
const PLAYER_LIMIT = 5000;
const COMPETITION_LIMIT = 1000;

/**
 * A plain anon-key client rather than createServerSupabaseClient(), for two
 * reasons that both still hold under Supabase Auth. sitemap.xml is statically
 * generated at build time, where there is no request and therefore no cookie
 * store for the cookie-backed server client to read; and it is excluded from
 * src/proxy.ts's matcher anyway (the negative lookahead skips any dotted
 * path), so even at runtime nothing would have refreshed a session for it.
 * teams/players/competitions carry no RLS regardless — public football data,
 * the same tables every guest-viewable list page already reads
 * unauthenticated — so an anon client is both correct here and simpler.
 */
// Returns null instead of throwing when the env vars aren't set yet — this
// runs at build time (sitemap.xml is statically generated), so a missing var
// must degrade to "skip the DB-derived entries," never fail the whole build.
function createAnonSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${siteUrl}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  const supabase = createAnonSupabaseClient();
  if (!supabase) return staticEntries;

  const [{ data: teams }, { data: players }, { data: competitions }] = await Promise.all([
    supabase.from("teams").select("id, updated_at").limit(TEAM_LIMIT),
    supabase.from("players").select("id, updated_at").limit(PLAYER_LIMIT),
    supabase.from("competitions").select("id, updated_at").limit(COMPETITION_LIMIT),
  ]);

  const teamEntries: MetadataRoute.Sitemap = (teams ?? []).map((team) => ({
    url: `${siteUrl}/teams/${team.id}`,
    lastModified: new Date(team.updated_at),
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  const playerEntries: MetadataRoute.Sitemap = (players ?? []).map((player) => ({
    url: `${siteUrl}/players/${player.id}`,
    lastModified: new Date(player.updated_at),
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  const leagueEntries: MetadataRoute.Sitemap = (competitions ?? []).map((competition) => ({
    url: `${siteUrl}/leagues/${competition.id}`,
    lastModified: new Date(competition.updated_at),
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  // If teams/players/competitions are empty (e.g. a freshly provisioned
  // project with no data synced yet), these arrays are just empty — fewer
  // entries is the honest result, not a bug to work around.
  return [...staticEntries, ...teamEntries, ...playerEntries, ...leagueEntries];
}
