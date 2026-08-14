import type { CSSProperties } from "react";
import kivoLogo from "../../../public/brand/kivo-logo.png";

// The square brand lockup (public/brand/kivo-logo.png) stacks the K mark on
// top of the "KIVO" wordmark + tagline + heartbeat line. This crops to just
// the mark by rendering the source at 1/CROP its container height inside an
// overflow-hidden box, sized in real pixels (not percentages) so it doesn't
// depend on object-fit/object-position resolving against an auto-height
// parent. Purely decorative everywhere it's used (aria-hidden), so a plain
// <img> is used instead of next/image to keep full control over sizing and
// opacity without next/image's `fill` mode forcing its own inline height.
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
  return (
    <div
      className={`kivo-mark-glyph ${reverse ? "kivo-mark-glyph--reverse" : ""} ${className}`}
      style={{ width: size, height: size, opacity, ...style }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- see file comment above */}
      <img src={kivoLogo.src} alt="" style={{ width: size, height: size / CROP }} />
    </div>
  );
}
