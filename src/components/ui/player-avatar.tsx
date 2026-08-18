import Image from "next/image";
import { UserRound } from "lucide-react";

/**
 * Shared player headshot renderer (RECOMMENDATIONS.md item 56): the real
 * provider photo when `photoUrl` is set (players.photo_url, synced from
 * API-Football's /players/squads "photo" field), otherwise the same
 * UserRound-in-a-soft-circle placeholder every player-facing surface already
 * used before a photo was ever available. Mirrors TeamCrest's shape exactly.
 *
 * `size` defaults to 36 — the size the majority of call sites already used
 * as a local hardcoded value before this consolidation.
 */
export function PlayerAvatar({
  photoUrl,
  name,
  size = 36,
}: {
  photoUrl: string | null;
  name: string | null;
  size?: number;
}) {
  if (photoUrl) {
    return (
      <Image
        src={photoUrl}
        alt={name ?? ""}
        width={size}
        height={size}
        // Same rationale as TeamCrest (RECOMMENDATIONS item 86): headshots render
        // at 32-64px everywhere this is used, never large enough to benefit from
        // Next's responsive multi-size optimization pipeline.
        unoptimized
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-surface-1"
      style={{ width: size, height: size }}
    >
      <UserRound className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.5} />
    </div>
  );
}
