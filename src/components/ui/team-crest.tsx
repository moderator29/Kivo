import Image from "next/image";
import { Shield } from "lucide-react";

/**
 * Shared team crest renderer: the real crest image when `crestUrl` is set,
 * otherwise a Shield-icon placeholder in a soft circle. Every page that
 * shows a team (matches, teams, players, leagues, live, predictions,
 * transfers, fantasy) independently defined this exact same shape as a local
 * `TeamCrest` function, differing only in a fixed pixel size (or, on a few
 * pages, an explicit `size` prop already doing the same thing) — this is the
 * single consolidated version every one of those call sites now uses.
 *
 * `size` defaults to 28, the size used by the majority of call sites before
 * this consolidation (players/[id], teams/[id]'s own default, live, matches,
 * prediction-card); call sites that used a different fixed size pass it
 * explicitly, same as before.
 */
export function TeamCrest({
  crestUrl,
  name,
  size = 28,
}: {
  crestUrl: string | null;
  name: string | null;
  size?: number;
}) {
  if (crestUrl) {
    return (
      <Image
        src={crestUrl}
        alt={name ?? ""}
        width={size}
        height={size}
        className="shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-white/5"
      style={{ width: size, height: size }}
    >
      <Shield className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />
    </div>
  );
}
