"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Star, Check } from "lucide-react";
import { toggleFollow } from "@/app/(app)/follow-actions";
import { GUEST_ACTION_TITLE, GuestLockHint } from "@/components/ui/guest-lock-hint";

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
  // docs/BUG_AUDIT_2026-08-18.md S1: same silently-discarded error as
  // SaveButton had — a rate limit or a moderation block on `follows_insert_own`
  // reverted the star with nothing said. See save-button.tsx.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timeout);
  }, [error]);

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
    setError(null);
    setFollowing(!previous);
    startTransition(async () => {
      const result = await toggleFollow(targetType, targetId, previous);
      if (result.error) {
        setFollowing(previous);
        setError(result.error);
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
        title={!signedIn ? GUEST_ACTION_TITLE : undefined}
        className={`relative flex shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60 ${dimension} ${
          following ? "border-achievement/40 bg-achievement/10" : "border-hairline hover:bg-surface-2"
        }`}
      >
        <Star
          className={`${iconSize} transition ${following ? "fill-achievement text-achievement" : "text-foreground-subtle"}`}
          strokeWidth={1.75}
        />
        {/* RECOMMENDATIONS item 235: pinned to the circle's corner rather than
            inline — there's no room for an inline glyph next to a single icon
            with no label. */}
        <span className="absolute -top-0.5 -right-0.5">
          <GuestLockHint
            show={!signedIn}
            className="h-3 w-3 rounded-full bg-surface text-foreground-subtle ring-1 ring-white/10"
          />
        </span>
      </button>
      <AnimatePresence>
        {flash && (
          <motion.span
            role="status"
            initial={{ opacity: 0, y: 4, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.9 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute -bottom-6 right-0 z-10 flex items-center gap-1 whitespace-nowrap rounded-full border border-hairline bg-background px-2 py-0.5 text-[11px] font-medium text-live shadow-lg"
          >
            <Check className="h-2.5 w-2.5" strokeWidth={2} />
            {flash === "followed" ? "Following" : "Unfollowed"}
          </motion.span>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 z-20 mt-1 w-max max-w-[14rem] text-right text-[11px] text-critical"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </span>
  );
}
