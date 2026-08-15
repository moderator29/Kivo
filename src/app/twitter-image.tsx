import { renderKivoBrandImage } from "@/lib/og/kivo-brand-image";

export const alt = "KIVO: Football. Together. Live.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Same image as opengraph-image.tsx — kept as a separate file (rather than
// relying on X/Twitter's og:image fallback) so the twitter:card meta tags
// Next generates always point at a real image.
export default async function Image() {
  return renderKivoBrandImage(size);
}
