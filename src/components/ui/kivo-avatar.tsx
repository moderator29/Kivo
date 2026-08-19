import Image from "next/image";
import { CircleUserRound } from "lucide-react";
import { kivoAvatarFramingForSrc } from "@/lib/kivo-assets";

/**
 * Shared avatar renderer, same "real image or icon placeholder" shape as
 * TeamCrest (src/components/ui/team-crest.tsx). Takes an already-resolved
 * `src` (see resolveAvatarSrc() in src/lib/kivo-assets.ts) rather than a raw
 * profile row, so it works equally for KIVO-native avatars (local
 * public/assets files), a user's own upload (Supabase Storage), and the
 * legacy avatar_url fallback (img.clerk.com, Clerk-synced before the
 * 2026-08-18 auth migration and no longer written by anything) — three different
 * hosts, none large enough to benefit from Next's optimizer (same reasoning
 * TeamCrest documents), so `unoptimized` is used unconditionally and no
 * next.config.ts remotePatterns entry is required for any of the three.
 *
 * One src shape gets special treatment: a KIVO-native avatar is framed to its
 * subject rather than centre-cropped. Those files are full-body renders with
 * the asset's own number on the shirt, and a centred square crop of one is a
 * picture of that number — see KIVO_AVATAR_FRAMING in src/lib/kivo-assets.ts
 * for the measurements and why a crop is the only fix available. Every other
 * src keeps the plain centred `object-cover` it always had.
 */
export function KivoAvatar({
  src,
  name,
  size = 40,
  className = "",
  radiusClassName = "rounded-full",
}: {
  src: string | null;
  name?: string | null;
  size?: number;
  className?: string;
  /**
   * The corner radius, as a Tailwind class. Circular everywhere by default,
   * which is what every existing caller wants and gets without saying so.
   *
   * It is a prop rather than something a caller tacks onto `className` because
   * the radius is applied to a different element on each of the three branches
   * below (a cropping wrapper, an `<Image>`, a placeholder box) — and a
   * `rounded-2xl` appended to `className` would not reliably beat the
   * `rounded-full` already in the string, since equal-specificity classes are
   * resolved by stylesheet order, not by the order they appear in the
   * attribute. The account switcher's rounded-square avatars are the first
   * caller that needs it.
   */
  radiusClassName?: string;
}) {
  const framing = kivoAvatarFramingForSrc(src);

  if (src && framing) {
    // A plain <img> inside an overflow-hidden box, not next/image: the crop is
    // expressed as percentage width/height/offsets against the container, and
    // next/image writes its own width/height/position inline styles that would
    // fight with them. The source is a local ~50KB webp, so nothing is lost by
    // skipping the optimizer — which `unoptimized` skips on the other branch
    // anyway. Percentages all divide by the same `side`, so the image scales
    // uniformly and cannot be stretched.
    return (
      <div
        className={`relative shrink-0 overflow-hidden ${radiusClassName} ${className}`}
        style={{ width: size, height: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- see comment above */}
        <img
          src={src}
          alt={name ?? ""}
          style={{
            position: "absolute",
            width: `${(framing.width / framing.side) * 100}%`,
            height: `${(framing.height / framing.side) * 100}%`,
            left: `${(-framing.x / framing.side) * 100}%`,
            top: `${(-framing.y / framing.side) * 100}%`,
            maxWidth: "none",
          }}
        />
      </div>
    );
  }

  if (src) {
    return (
      <Image
        src={src}
        alt={name ?? ""}
        width={size}
        height={size}
        unoptimized
        className={`shrink-0 ${radiusClassName} object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center ${radiusClassName} bg-surface-2 ${className}`}
      style={{ width: size, height: size }}
    >
      <CircleUserRound className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />
    </div>
  );
}
