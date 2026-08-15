"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Star, Check } from "lucide-react";
import { toggleFollow } from "@/app/(app)/follow-actions";

// RECOMMENDATIONS item 175: "user" added so this same button can follow
// another profile, not just team/player/competition — same star affordance,
// already used site-wide for "follow", reused rather than inventing a
// second follow control just for people.
type FollowTargetType = "team" | "player" | "competition" | "user";

type FollowButtonProps = {
  targetType: FollowTargetType;
  targetId: string;
  initialFollowing: boolean;
  /** Whether the viewer is signed in. Guests still see the button (guest-CTA
   * pattern, matching PostCard/PredictionCard) and are routed to sign-up on
   * tap instead of the server action firing. */
  signedIn: boolean;
  size?: "sm" | "md";
};

export function FollowButton({ targetType, targetId, initialFollowing, signedIn, size = "md" }: FollowButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<"followed" | "unfollowed" | null>(null);

  // Ephemeral on-brand confirmation, same flash-then-fade shape as
  // UsernameEditor's "Saved" pill — no app-wide toast system exists yet, and
  // this one action doesn't warrant building one.
  useEffect(() => {
    if (!flash) return;
    const timeout = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(timeout);
  }, [flash]);

  function handleClick() {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending) return;
    const previous = following;
    setFollowing(!previous);
    startTransition(async () => {
      const result = await toggleFollow(targetType, targetId, previous);
      if (result.error) {
        setFollowing(previous);
      } else {
        setFollowing(result.following);
        setFlash(result.following ? "followed" : "unfollowed");
      }
    });
  }

  const dimension = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <span className="relative flex shrink-0 items-center">
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={handleClick}
        aria-pressed={following}
        aria-label={following ? "Unfollow" : "Follow"}
        className={`flex shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-60 ${dimension} ${
          following ? "border-achievement/40 bg-achievement/10" : "border-white/10 hover:bg-white/5"
        }`}
      >
        <Star
          className={`${iconSize} transition ${following ? "fill-achievement text-achievement" : "text-foreground-subtle"}`}
          strokeWidth={1.75}
        />
      </button>
      <AnimatePresence>
        {flash && (
          <motion.span
            role="status"
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute -bottom-6 right-0 z-10 flex items-center gap-1 whitespace-nowrap rounded-full border border-white/10 bg-kivo-obsidian px-2 py-0.5 text-[11px] font-medium text-live shadow-lg"
          >
            <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
            {flash === "followed" ? "Following" : "Unfollowed"}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
