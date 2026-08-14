import type { MetadataRoute } from "next";

// Same env var convention as the root layout's metadataBase (src/app/layout.tsx).
const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Robots.txt path matching is prefix-based, so allowing "/teams" also covers
// "/teams/{id}" detail pages (same for players and leagues) without needing
// a separate entry per dynamic route.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/home", "/matches", "/teams", "/players", "/leagues", "/discover", "/live", "/transfers"],
      disallow: [
        "/settings",
        "/profile",
        "/fantasy",
        "/rewards",
        "/predictions",
        "/social",
        "/ai",
        "/admin",
        "/api",
        "/onboarding",
        "/sign-in",
        "/sign-up",
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
