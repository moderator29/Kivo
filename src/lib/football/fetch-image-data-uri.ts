import "server-only";

// next/og's bundled image renderer (resvg, via @vercel/og) only reliably
// rasterizes PNG/JPEG <img> sources — verified directly against this app's
// own template asset before writing this: a WEBP data URI throws inside
// resvg ("u2 is not iterable"), a PNG one renders cleanly. Real crest URLs
// (teams.crest_url, from API-Football/TheSportsDB) are typically PNG, but
// format isn't guaranteed, so every crest is fetched, magic-byte-sniffed,
// and only turned into a data URI when it's actually PNG/JPEG — anything
// else (SVG, WEBP, a dead link, a timeout) falls back to the initials badge
// in the /share-card route rather than risking the whole image render
// throwing over one team's crest.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function sniffMimeType(bytes: Uint8Array): "image/png" | "image/jpeg" | null {
  if (bytes.length >= 4 && PNG_MAGIC.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && JPEG_MAGIC.every((b, i) => bytes[i] === b)) return "image/jpeg";
  return null;
}

export async function fetchImageDataUri(url: string, timeoutMs = 4000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    const mime = sniffMimeType(bytes);
    if (!mime) return null;

    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch {
    return null;
  }
}
