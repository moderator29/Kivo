import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // API-Football serves team crests from this CDN — required for next/image to
    // render them on the Matches page without erroring on an unconfigured host.
    remotePatterns: [{ protocol: "https", hostname: "media.api-sports.io" }],
  },
};

export default nextConfig;
