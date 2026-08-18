import Image from "next/image";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";

/**
 * The banner strip at the top of a profile — the ten confirmed-clean KIVO
 * covers (`KIVO_BACKGROUND_IDS`), a user's own uploaded image (migration
 * 0065's `backgrounds` bucket), or, when they have chosen neither, a
 * deliberate brand plate rather than a hole.
 *
 * That empty state matters more than the filled one: no default cover is ever
 * assigned (see `clearBackground`), so it is what most profiles actually show.
 * It is built entirely from theme tokens plus the KIVO mark at low opacity, so
 * it reads as "this is a KIVO profile" in both themes instead of as a missing
 * image.
 *
 * Replaces the old `KivoProfileBackground`, which rendered the image *behind*
 * the whole header card under a hardcoded dark scrim
 * (`.kivo-profile-background-overlay`). That scrim was obsidian-only — it
 * dimmed a light-theme profile to near-black — and it only existed because
 * text sat on top of the image. Here nothing does: the cover is a band, the
 * identity sits below it, and no scrim is needed in either theme.
 */
export function ProfileCover({
  src,
  className = "",
  priority = false,
  sizes = "(min-width: 672px) 672px, 100vw",
}: {
  src: string | null;
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  if (!src) {
    return (
      <div className={`relative overflow-hidden bg-surface-2 ${className}`}>
        {/* Two soft brand washes rather than a flat fill: a cover is the
            widest single element on the page, and a flat panel that size
            reads as unstyled. Kept low-opacity so it never competes with the
            avatar and name that sit over its bottom edge. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.18]"
          style={{
            background:
              "radial-gradient(120% 140% at 12% 0%, var(--kivo-cyan), transparent 60%), radial-gradient(120% 140% at 88% 100%, var(--kivo-violet), transparent 62%)",
          }}
        />
        <KivoMarkGlyph
          size={104}
          opacity={0.07}
          className="absolute -right-4 top-1/2 -translate-y-1/2"
        />
      </div>
    );
  }

  // `unoptimized` is required, not a preference: this one component renders
  // both a local KIVO cover (45-77KB webp, already about as small as the
  // optimizer would make it) and a user's own upload, which is served from the
  // Supabase Storage origin. That origin is in the CSP's `img-src`
  // (next.config.ts derives it from NEXT_PUBLIC_SUPABASE_URL) but deliberately
  // NOT in `images.remotePatterns`, so routing it through /_next/image would
  // answer 400 — the same reason KivoAvatar and TeamCrest pass it.
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <Image src={src} alt="" fill priority={priority} sizes={sizes} unoptimized className="object-cover" />
    </div>
  );
}
