"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Star, Bell, BellOff, Check, Undo2 } from "lucide-react";
import { toggleFollow, toggleFollowMute } from "@/app/(app)/follow-actions";
import { GUEST_ACTION_TITLE, GuestLockHint } from "@/components/ui/guest-lock-hint";
import { FOLLOW_MEANING, FOLLOW_MUTED_MEANING } from "@/lib/follow-meaning";

type MutableFollowTargetType = "team" | "player";

type FollowWithMuteProps = {
  targetType: MutableFollowTargetType;
  targetId: string;
  initialFollowing: boolean;
  initialMuted: boolean;
  /** Whether the viewer is signed in. Guests still see the button (guest-CTA
   * pattern, matching FollowButton/SaveButton) and are routed to sign-up on
   * tap instead of the server action firing. */
  signedIn: boolean;
  size?: "sm" | "md";
};

/**
 * RECOMMENDATIONS.md item 287: team/player pages need both the existing
 * follow star (FollowButton) and a mute toggle that only makes sense once
 * following — the two need to share live "am I following" state (mute must
 * disappear the instant you unfollow, and never outlive the follow row it
 * mutes), so this is a small dedicated composite for team/player specifically
 * rather than complicating FollowButton's own shape for every target type.
 * Competition and user follows keep plain FollowButton unchanged — there's no
 * competition/user audience builder in match-notifications.ts for a mute to
 * exclude rows from, so a mute control there would control nothing real.
 *
 * Duplicates FollowButton's own optimistic-update + flash-confirmation shape
 * rather than generalizing it — the same trade-off SaveButton already makes
 * (see its own comment) for a second, differently-shaped toggle button.
 */
export function FollowWithMute({
  targetType,
  targetId,
  initialFollowing,
  initialMuted,
  signedIn,
  size = "md",
}: FollowWithMuteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [following, setFollowing] = useState(initialFollowing);
  const [muted, setMuted] = useState(initialMuted);
  const [followPending, startFollowTransition] = useTransition();
  const [mutePending, startMuteTransition] = useTransition();
  const [flash, setFlash] = useState<"followed" | "unfollowed" | "muted" | "unmuted" | null>(null);

  // KN-51: long enough to actually read a sentence. The old 1600ms was sized
  // for the single word ("Following") this used to show; the point of the item
  // is that one word never explained what the gesture did.
  useEffect(() => {
    if (!flash) return;
    const timeout = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(timeout);
  }, [flash]);

  function handleFollowClick() {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (followPending) return;
    const previous = following;
    setFollowing(!previous);
    // Unfollowing deletes the follows row outright — its mute flag goes with
    // it, so local state resets to unmuted rather than showing a mute toggle
    // that would silently no-op if tapped (also hidden below while !following).
    if (previous) setMuted(false);
    startFollowTransition(async () => {
      const result = await toggleFollow(targetType, targetId, previous);
      if (result.error) {
        setFollowing(previous);
      } else {
        setFollowing(result.following);
        setFlash(result.following ? "followed" : "unfollowed");
      }
    });
  }

  function handleMuteClick() {
    if (!signedIn || !following || mutePending) return;
    const previous = muted;
    setMuted(!previous);
    startMuteTransition(async () => {
      const result = await toggleFollowMute(targetType, targetId, previous);
      if (result.error) {
        setMuted(previous);
      } else {
        setMuted(result.muted);
        setFlash(result.muted ? "muted" : "unmuted");
      }
    });
  }

  const dimension = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <span className="relative flex shrink-0 items-center gap-2">
      <button
        type="button"
        disabled={followPending}
        aria-busy={followPending}
        onClick={handleFollowClick}
        aria-pressed={following}
        aria-label={following ? "Unfollow" : "Follow"}
        title={!signedIn ? GUEST_ACTION_TITLE : undefined}
        className={`relative flex shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-60 ${dimension} ${
          following ? "border-achievement/40 bg-achievement/10" : "border-white/10 hover:bg-white/5"
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

      {following && (
        <button
          type="button"
          disabled={mutePending}
          aria-busy={mutePending}
          onClick={handleMuteClick}
          aria-pressed={muted}
          aria-label={muted ? "Unmute notifications" : "Mute notifications"}
          title={muted ? "Notifications muted" : "Mute notifications"}
          className={`flex shrink-0 items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-60 ${dimension} ${
            muted ? "border-white/15 bg-white/[0.06]" : "border-white/10 hover:bg-white/5"
          }`}
        >
          {muted ? (
            <BellOff className={`${iconSize} text-foreground-subtle`} strokeWidth={1.75} />
          ) : (
            <Bell className={`${iconSize} text-foreground-muted`} strokeWidth={1.75} />
          )}
        </button>
      )}

      {/* KN-51: this used to be a one-word pill ("Following"), which is exactly
          the problem the item names — the single most load-bearing
          personalisation gesture in the product explained itself with a star
          changing colour. The confirmation now says what actually changed, in
          the words of the real consumers (see src/lib/follow-meaning.ts), at
          the one moment the user is guaranteed to be looking: immediately
          after they tapped. Absolutely positioned so it never reflows the
          header it sits in. */}
      <AnimatePresence>
        {flash && (
          <motion.div
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-full right-0 z-20 mt-2 w-60 rounded-xl border border-hairline bg-surface-raised p-3 text-left shadow-lg"
          >
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-live">
              <Check className="h-3 w-3 shrink-0" strokeWidth={2} />
              {flash === "followed" && "Following"}
              {flash === "unfollowed" && "Unfollowed"}
              {flash === "muted" && "Muted"}
              {flash === "unmuted" && "Unmuted"}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-foreground-muted">
              {flash === "followed" && FOLLOW_MEANING[targetType]}
              {flash === "muted" && FOLLOW_MUTED_MEANING[targetType]}
              {flash === "unmuted" && "Match alerts for this one are back on."}
              {flash === "unfollowed" && "They're off your Following list, and no alerts will reach you."}
            </p>
            {/* KN-59: undo, not a confirmation dialog. Unfollowing is one tap
                with no warning and no way back, and the item proposed
                confirming it — but a modal in front of a *reversible* action
                taxes the 99 correct taps to protect the one mistake. Undo
                inverts that: the common case stays instant, and the mistake
                costs one more tap. (The two genuinely irreversible actions in
                the product — deleting your account and deleting an AI
                conversation — both already confirm, and still do.)

                What undo restores is the follow itself. A mute flag lived on
                the row that was deleted, so it does not come back — which is
                why the button says "Follow again" rather than pretending to
                rewind time. */}
            {flash === "unfollowed" && (
              <button
                type="button"
                onClick={handleFollowClick}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-accent transition-colors hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <Undo2 className="h-3 w-3" strokeWidth={2} />
                Follow again
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
