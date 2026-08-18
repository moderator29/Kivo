import Image from "next/image";
import { cn } from "@/lib/utils";
import kivoLogo from "../../../public/brand/kivo-logo-transparent.webp";

/**
 * The K mark on its own, cropped out of the square brand lockup.
 *
 * `public/brand/kivo-logo-transparent.webp` is a stacked lockup — mark, then
 * the KIVO wordmark, then the tagline, then the heartbeat rule. Wherever the
 * mark alone is wanted at display size (the landing hero), rendering the
 * whole lockup means the wordmark and tagline come along and the mark itself
 * ends up small inside its own box.
 *
 * The crop below is measured off the asset's alpha channel rather than eyeballed:
 * the mark's ink occupies x ∈ [26.95%, 77.93%] and y ∈ [11.52%, 59.96%] of the
 * square. Those four numbers drive everything here, so if the asset is ever
 * re-exported they are the only things to re-measure.
 *
 * How the crop works: the image is blown up so the mark's own width fills the
 * box (1 / 0.5098 ≈ 196%), then translated by exactly the mark's top-left
 * offset. Because `transform: translate()` percentages resolve against the
 * translated element's own size, the offsets are simply the measured
 * percentages negated — no arithmetic against the container, and it stays
 * correct at every size. The box's aspect ratio is the mark's own, so it
 * hugs the glyph with no dead space to align around.
 */
const MARK = { left: 0.2695, right: 0.7793, top: 0.1152, bottom: 0.5996 };
const MARK_W = MARK.right - MARK.left;
const MARK_H = MARK.bottom - MARK.top;

export function KivoMark({
  className,
  priority = false,
  alt = "",
  sizes = "(min-width: 1024px) 640px, (min-width: 640px) 500px, 420px",
}: {
  /** Sets the mark's WIDTH; height follows from the mark's own aspect ratio. */
  className?: string;
  priority?: boolean;
  /** Empty by default — decorative. Pass "KIVO" when it is the only branding. */
  alt?: string;
  sizes?: string;
}) {
  return (
    <span
      className={cn("relative block overflow-hidden", className)}
      style={{ aspectRatio: `${MARK_W} / ${MARK_H}` }}
    >
      <Image
        src={kivoLogo}
        alt={alt}
        priority={priority}
        sizes={sizes}
        className="absolute left-0 top-0 h-auto max-w-none"
        style={{
          width: `${(1 / MARK_W) * 100}%`,
          transform: `translate(${-MARK.left * 100}%, ${-MARK.top * 100}%)`,
        }}
      />
    </span>
  );
}
