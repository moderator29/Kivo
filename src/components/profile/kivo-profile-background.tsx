import type { ReactNode } from "react";
import Image from "next/image";
import { isKivoBackgroundId, kivoBackgroundPath } from "@/lib/kivo-assets";

/**
 * Renders a user's chosen KIVO background (RECOMMENDATIONS items 231/232,
 * KIVO_BACKGROUND_IDS) behind profile content, with a dark scrim
 * (.kivo-profile-background-overlay in globals.css, reusing this app's own
 * obsidian/glass tokens) so foreground .kivo-glass cards/text stay readable
 * on top of it.
 *
 * Most users won't have picked one yet (background_id defaults to null, no
 * forced default per this feature's own spec) — `backgroundId` null/invalid
 * renders `children` completely plainly, no wrapper, no image request, no
 * empty decorative shell.
 */
export function KivoProfileBackground({
  backgroundId,
  children,
}: {
  backgroundId: string | null;
  children: ReactNode;
}) {
  if (!isKivoBackgroundId(backgroundId)) {
    return <>{children}</>;
  }

  return (
    <div className="relative isolate overflow-hidden rounded-3xl">
      <Image
        src={kivoBackgroundPath(backgroundId)}
        alt=""
        fill
        priority={false}
        // Backgrounds are the full width of the profile column at every
        // breakpoint (max-w-2xl caps it at 42rem/672px on desktop) — never
        // wider than the viewport, so a single width-tiered `sizes` covers
        // mobile through desktop without ever fetching a larger source than
        // what's actually painted.
        sizes="(min-width: 672px) 672px, 100vw"
        className="object-cover"
      />
      <div aria-hidden="true" className="kivo-profile-background-overlay" />
      <div className="relative z-10 p-3">{children}</div>
    </div>
  );
}
