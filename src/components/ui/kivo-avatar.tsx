import Image from "next/image";
import { CircleUserRound } from "lucide-react";

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
 */
export function KivoAvatar({
  src,
  name,
  size = 40,
  className = "",
}: {
  src: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      <Image
        src={src}
        alt={name ?? ""}
        width={size}
        height={size}
        unoptimized
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-surface-2 ${className}`}
      style={{ width: size, height: size }}
    >
      <CircleUserRound className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.5} />
    </div>
  );
}
