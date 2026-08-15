import type { MetadataRoute } from "next";

// Colors match --kivo-obsidian / the app shell background in globals.css, so
// the OS splash screen and any browser chrome tint agree with the app itself.
const OBSIDIAN = "#05060a";

// icons: public/ only has favicon.ico (16x16 + 32x32, see src/app/favicon.ico)
// and the full KIVO wordmark lockup (public/brand/kivo-logo.png /.webp) —
// there's no dedicated icon-only mark or any pre-sized 192x192 / 512x512 /
// maskable PNG. Resizing the full lockup down to app-icon sizes would just
// turn the "KIVO" wordmark and tagline into an unreadable smear, so rather
// than ship that, this only lists what's real today. See the task report for
// what's still needed before this manifest satisfies Chrome's installability
// checklist (which wants an icon >= 192px, ideally 512px too).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KIVO: Football. Together. Live.",
    short_name: "KIVO",
    description:
      "KIVO is a premium football fan platform: live scores, an AI Copilot grounded in real data, match rooms, fantasy, and predictions.",
    start_url: "/",
    display: "standalone",
    background_color: OBSIDIAN,
    theme_color: OBSIDIAN,
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
