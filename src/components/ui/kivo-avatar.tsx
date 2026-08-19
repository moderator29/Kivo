import Image from "next/image";
import { CircleUserRound } from "lucide-react";
import { kivoAvatarDescriptionForSrc } from "@/lib/kivo-assets";

/**
 * THE avatar. Every surface in KIVO that draws a person's picture draws it
 * through this component — profile header, profile editor, the two pickers,
 * the desktop sidebar, the nav drawer, the bottom bar, post cards, comments,
 * the composer, the compose entry point, the follow lists, the account
 * switcher, onboarding. There is no second way to render one.
 *
 * That rule is the whole point. The bug this replaces was not one bad crop:
 * it was eleven call sites each deciding for itself what an avatar looks
 * like. Some passed a `src` here and got a per-asset head crop; the rest wrote
 * their own `<Image className="object-cover">` inside their own wrapper and
 * got a centred square of whatever the file happened to be. The same person
 * showed a face in the profile and a torso in the sidebar. If you are about
 * to write `<Image>` for an avatar, use this instead — and if it cannot do
 * what you need, change it here so every surface changes with it.
 *
 * ONE SHAPE, ONE FIT. A KIVO avatar file is a square panel, and the frame is
 * square, so `object-cover` crops nothing at all: the artwork is shown whole,
 * as it was composed, at every size. An uploaded photo is not square, so it
 * gets the centred cover crop every product uses for a profile picture — the
 * same treatment, in the same frame, which is what makes an upload and a
 * commissioned illustration look like they belong to the same product.
 *
 * `unoptimized` is unconditional and deliberate, matching TeamCrest: the
 * three possible hosts are this app's own `public/` (a ~40KB webp already
 * sized for its largest render), Supabase Storage, and the legacy
 * `img.clerk.com` rows, and none of them benefits enough from the optimizer
 * to be worth a `remotePatterns` entry per host.
 */

/**
 * The avatar's corner radius, in one place, as a percentage of its own box so
 * it scales with `size` instead of needing a per-size class.
 *
 * A superellipse rather than a circle because a circle discards the corners
 * of the artwork, and the corners of a KIVO avatar are artwork: the cape in
 * 01, the extended arms in 14, the goal net in 15. "Show it fully" is the
 * requirement, and a full square with softened corners is the shape that
 * honours it while still reading as an avatar rather than a photo tile.
 *
 * Nothing in the product overrides it. `radiusClassName` exists for one
 * mechanical case — the picker grid, which puts the radius on its own
 * clipping wrapper and passes "" here so the two do not double up. If you
 * find yourself passing a different radius to make one screen look right,
 * that is the bug this component was written to end.
 */
export const AVATAR_RADIUS_CLASS = "rounded-[28%]";

export function KivoAvatar({
  src,
  name,
  size = 40,
  fill = false,
  className = "",
  radiusClassName = AVATAR_RADIUS_CLASS,
  priority = false,
  alt,
}: {
  src: string | null;
  /** The person this avatar belongs to. Used as alt text when there is one. */
  name?: string | null;
  /** Rendered edge length in px. Ignored when `fill` is set. */
  size?: number;
  /**
   * Fill the nearest positioned ancestor instead of taking a fixed `size`.
   * For the one case where the avatar's size is decided by layout rather than
   * by the caller — the picker grid, whose tiles are a fraction of the
   * viewport. The parent must be `relative` and must set its own square
   * aspect ratio, exactly as `next/image`'s own `fill` requires.
   */
  fill?: boolean;
  className?: string;
  radiusClassName?: string;
  priority?: boolean;
  /**
   * Overrides the derived alt text. Pass `""` when a label next to or around
   * the avatar already names the person — a picker option whose button is
   * itself labelled, a row whose display name sits beside it — so a screen
   * reader is not told the same thing twice.
   */
  alt?: string;
}) {
  // A KIVO avatar can describe its own artwork; an upload cannot, so it falls
  // back to the person's name and then to nothing rather than to a filename.
  const derivedAlt = alt ?? name ?? kivoAvatarDescriptionForSrc(src) ?? "";

  const box = fill ? undefined : { width: size, height: size };

  if (src) {
    return (
      <Image
        src={src}
        alt={derivedAlt}
        {...(fill ? { fill: true } : { width: size, height: size })}
        sizes={fill ? "(min-width: 640px) 120px, 33vw" : undefined}
        unoptimized
        priority={priority}
        className={`shrink-0 bg-surface-2 object-cover ${radiusClassName} ${className}`}
        style={box}
      />
    );
  }

  // No picture. One empty state, not one per call site: the person's initial
  // on KIVO's own gradient when we know who they are, and a neutral glyph when
  // we genuinely do not. Post cards used to draw the initial and comments the
  // glyph, for the same missing avatar on the same screen.
  const initial = name?.trim()?.charAt(0)?.toUpperCase();

  return (
    <div
      className={`flex items-center justify-center ${
        initial ? "kivo-gradient-prime font-semibold text-on-accent" : "bg-surface-2"
      } ${fill ? "absolute inset-0" : "shrink-0"} ${radiusClassName} ${className}`}
      style={box ? { ...box, fontSize: Math.round(size * 0.42) } : undefined}
      role={derivedAlt ? "img" : undefined}
      aria-label={derivedAlt || undefined}
      aria-hidden={derivedAlt ? undefined : true}
    >
      {initial ?? <CircleUserRound className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />}
    </div>
  );
}
