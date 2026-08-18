import Image from "next/image";
import { Trophy } from "lucide-react";

/**
 * Shared competition/league logo renderer — the third member of the family
 * TeamCrest and PlayerAvatar already form, added for KIVO_NEXT_GEN KN-2.
 *
 * The two call sites this replaces (`leagues-list.tsx` and `leagues/[id]`)
 * each rendered a bare `<Image>` at 32-36px straight from the provider CDN,
 * which meant they went through next/image's optimizer and so depended on the
 * host being present in `images.remotePatterns` — the exact coupling that
 * makes switching FOOTBALL_DATA_PROVIDER break rendering. Like TeamCrest, this
 * renders `unoptimized`: at this size the optimizer's fetch/resize/cache round
 * trip is pure overhead (RECOMMENDATIONS item 86), and the browser fetching the
 * host directly is governed by the CSP's `img-src`, which is derived from the
 * same constant `remotePatterns` is (src/lib/football/image-hosts.ts).
 *
 * The fallback is Trophy on both surfaces. `leagues/[id]` previously fell back
 * to a Shield while the list it is reached from used a Trophy for the same
 * competition — one icon for one concept is the point of consolidating these.
 */
export function CompetitionLogo({
  logoUrl,
  name,
  size = 32,
}: {
  logoUrl: string | null;
  name: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <Image
        src={logoUrl}
        alt={name ?? ""}
        width={size}
        height={size}
        unoptimized
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-2"
      style={{ width: size, height: size }}
    >
      <Trophy className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />
    </div>
  );
}
