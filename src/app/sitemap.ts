import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * KN-119. This file used to publish roughly 11,000 URLs: nine app routes plus
 * up to 5,000 teams, 5,000 players and 1,000 leagues, read live from the
 * database with an anon key.
 *
 * Every single one of them now returns a sign-in wall. The 2026-08-18 move to
 * Supabase Auth gated the whole `(app)` group with no guest preview
 * (`src/app/(app)/layout.tsx`), which means a crawler following any of those
 * URLs gets `/sign-in`, and so does the friend somebody sent a match link to.
 * Continuing to advertise them is the same class of untruth as a fabricated
 * statistic: KIVO would be telling search engines it has 11,000 pages of
 * football content and handing them a login form 11,000 times. Google treats
 * that as low-quality/soft-404 signal against the whole domain.
 *
 * So the sitemap now lists exactly what an unauthenticated visitor can really
 * read. That is the honest answer under the current product decision, not the
 * ambitious one — the ambitious one (a genuine read-only public preview of
 * `/matches/[id]` and the entity pages, which is what a fan-sharing growth loop
 * actually needs) is a product decision only the founder can make, and it is
 * written up as an open recommendation in DECISIONS.md rather than assumed
 * here. When that call is made, this file and robots.ts are where it lands.
 *
 * No `lastModified` on any entry: none of these corresponds to a single real
 * record with an `updated_at`, and a timestamp we made up would be a fabricated
 * freshness claim.
 */
const PUBLIC_ROUTES: {
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  // Genuinely worth indexing, not filler: a user locked out of KIVO cannot
  // reach anything inside the product to find help, so the route they are
  // most likely to arrive by is a search engine (KN-118).
  { path: "/support", changeFrequency: "monthly", priority: 0.5 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const site = siteUrl();
  return PUBLIC_ROUTES.map((route) => ({
    url: `${site}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
