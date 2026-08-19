import Image from "next/image";
import type { CSSProperties } from "react";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

// The square brand lockup (public/brand/kivo-logo-transparent.webp) stacks the K mark on
// top of the "KIVO" wordmark + tagline + heartbeat line. This crops to just
// the mark by rendering the source at 1/CROP its container height inside an
// overflow-hidden box, sized in real pixels (not percentages) so it doesn't
// depend on object-fit/object-position resolving against an auto-height
// parent.
//
// This used to be a plain `<img src={kivoLogo.src}>`, to keep full control of
// that sizing. The control was real; the price was not. `kivo-logo-transparent.webp`
// is a 1254² source that weighs **689 KB**, and a plain `<img>` bypasses the
// optimizer entirely — so every page carrying this glyph downloaded 689 KB to
// draw 32 pixels. Measured against the running production build, the optimizer
// serves the same glyph as WebP at **3.2 KB** (w=64, what a DPR-3 phone picks
// for a 32px box). On the Slow-3G profile in docs/PERFORMANCE.md the 686 KB
// difference is about thirteen seconds of download — on the landing page, the
// marketing pages, the sign-in screen, onboarding, the profile cover, and every
// post in the social feed.
//
// `next/image` with explicit width/height (never `fill`, which would force its
// own inline height) keeps exactly the sizing this component always had: the
// `style` below is the real geometry, the width/height props exist so the
// optimizer knows which candidates to build. `.kivo-mark-glyph img` in
// globals.css absolutely positions it, so nothing here fights the crop.
const CROP = 0.64;

export function KivoMarkGlyph({
  size,
  opacity = 1,
  reverse = false,
  className = "",
  style,
}: {
  size: number;
  opacity?: number;
  reverse?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const renderedHeight = size / CROP;

  return (
    <div
      className={`kivo-mark-glyph ${reverse ? "kivo-mark-glyph--reverse" : ""} ${className}`}
      style={{ width: size, height: size, opacity, ...style }}
      aria-hidden="true"
    >
      <Image
        src={kivoLogo}
        alt=""
        // Rounded only because next/image takes integers; the exact geometry is
        // set in `style` below, so the crop is unchanged to the sub-pixel.
        width={Math.round(size)}
        height={Math.round(renderedHeight)}
        style={{ width: size, height: renderedHeight }}
        // Eager, not lazy: this glyph sits in the header of every marketing
        // page and in the top-left of the app shell, so it is above the fold
        // where lazy-loading only delays it. Not `priority` either — a preload
        // would push it ahead of the page's real content for a decorative 3 KB
        // mark. Every instance on a page resolves to the same URL, so the
        // twenty of them in a feed are still one request.
        loading="eager"
        className="max-w-none"
      />
    </div>
  );
}
