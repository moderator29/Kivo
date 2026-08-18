"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Bookmark, Check } from "lucide-react";
import { toggleSave, type SaveTargetType } from "@/app/(app)/save-actions";

type SaveButtonProps = {
  targetType: SaveTargetType;
  targetId: string;
  initialSaved: boolean;
  /** Whether the viewer is signed in. Guests still see the button (guest-CTA
   * pattern, matching FollowButton/PredictionCard) and are routed to sign-up
   * on tap instead of the server action firing. */
  signedIn: boolean;
  size?: "sm" | "md";
};

/** RECOMMENDATIONS item 173: compact bookmark toggle, same optimistic-update
 * + flash-confirmation shape as FollowButton, sized to sit inline in
 * PostCard's action row rather than as a standalone circular button. */
export function SaveButton({ targetType, targetId, initialSaved, signedIn, size = "sm" }: SaveButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const [flash, setFlash] = useState<"saved" | "unsaved" | null>(null);

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
    const previous = saved;
    setSaved(!previous);
    startTransition(async () => {
      const result = await toggleSave(targetType, targetId, previous);
      if (result.error) {
        setSaved(previous);
      } else {
        setSaved(result.saved);
        setFlash(result.saved ? "saved" : "unsaved");
      }
    });
  }

  const iconSize = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <span className="relative inline-flex shrink-0 items-center">
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-busy={pending}
        aria-pressed={saved}
        aria-label={saved ? "Remove from saved" : "Save"}
        whileTap={{ scale: 0.88 }}
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed ${
          saved ? "text-accent" : "text-foreground-subtle hover:text-foreground-muted"
        }`}
      >
        <Bookmark className={iconSize} strokeWidth={1.75} fill={saved ? "currentColor" : "none"} />
        {saved ? "Saved" : "Save"}
      </motion.button>
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
            <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
            {flash === "saved" ? "Saved" : "Removed"}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
