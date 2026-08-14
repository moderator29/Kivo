import { renderKivoBrandImage } from "@/lib/og/kivo-brand-image";

export const alt = "KIVO: Football. Together. Live.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Root default — any route segment without its own opengraph-image falls
// back to this one, so every shared KIVO link gets a branded card even
// before a per-entity image exists.
export default async function Image() {
  return renderKivoBrandImage(size);
}
