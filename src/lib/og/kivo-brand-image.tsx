import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The KIVO wordmark lockup is the only branded raster asset in public/ (see
// public/brand/) — there's no dedicated icon-only mark, so this is the same
// file used for the manifest/OG conversation elsewhere. It reads fine at
// 1200x630 (unlike at app-icon sizes), so it's a good fit for share images.
let logoSrcPromise: Promise<string> | null = null;

function getLogoSrc(): Promise<string> {
  if (!logoSrcPromise) {
    logoSrcPromise = readFile(join(process.cwd(), "public/brand/kivo-logo.png")).then(
      (buffer) => `data:image/png;base64,${buffer.toString("base64")}`,
    );
  }
  return logoSrcPromise;
}

/**
 * Renders KIVO's static branded share image: the wordmark centered on the
 * obsidian background with the same brand-gradient glow used on the landing
 * page's hero (see .kivo-aurora in globals.css). Shared by the root
 * opengraph-image.tsx and twitter-image.tsx routes so both stay in sync.
 */
export async function renderKivoBrandImage(size: { width: number; height: number }) {
  const logoSrc = await getLogoSrc();
  const logoSize = Math.round(Math.min(size.width, size.height) * 0.78);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#05060a",
          backgroundImage:
            "radial-gradient(circle at 18% 20%, rgba(0,217,255,0.22), transparent 55%), radial-gradient(circle at 85% 78%, rgba(217,70,239,0.2), transparent 55%), radial-gradient(circle at 50% 105%, rgba(124,63,255,0.18), transparent 60%)",
        }}
      >
        {/* next/og's Satori renderer requires a plain <img>, not next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} width={logoSize} height={logoSize} style={{ objectFit: "contain" }} alt="" />
      </div>
    ),
    { ...size },
  );
}
