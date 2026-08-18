import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * KN-119, the other half of the sitemap rewrite.
 *
 * This used to be an allow-list of app routes (`/home`, `/matches`, `/teams`,
 * `/players`, `/leagues`, `/live`, `/discover`, `/transfers`) with a disallow
 * list of the obviously-private ones. Since the whole `(app)` group went behind
 * auth, that split no longer describes anything real — all of those routes
 * answer with a sign-in wall.
 *
 * Inverted accordingly: allow only the genuinely public marketing pages, and
 * disallow everything else. `/sign-in` and `/sign-up` stay disallowed (they were
 * before too) — they are real, reachable pages, but a login form has no business
 * in an index, and letting a crawler queue them is how a sign-in page ends up
 * outranking the homepage.
 *
 * Path matching here is prefix-based, so a single "/" in `disallow` would block
 * everything including the pages we want indexed; the allow entries are listed
 * explicitly for that reason and, per the robots.txt spec, the longest matching
 * rule wins.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/about", "/support", "/terms", "/privacy"],
      disallow: ["/"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
