"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { SmilePlus } from "lucide-react";
import { setReaction } from "@/app/(app)/social/actions";
import { REACTIONS, type ReactionType } from "@/lib/reactions";
import { cn } from "@/lib/utils";

/**
 * Single-reaction picker for a post or comment — replaces the old
 * heart-only like toggle (RECOMMENDATIONS item 14). The trigger button shows
 * the viewer's active reaction (emoji) or a neutral "react" glyph, plus the
 * total count summed across all six types. Tapping the trigger while already
 * reacted clears it (same one-tap-to-undo feel as the old like button);
 * tapping it with no active reaction opens a small popover of all six —
 * click-to-open rather than hover-to-open so it behaves the same on touch
 * and with a mouse, matching the report-reason menu's existing pattern
 * (post-card.tsx).
 */
export function ReactionPicker({
  targetType,
  targetId,
  count,
  viewerReaction,
  signedIn,
  size = "md",
}: {
  targetType: "post" | "comment";
  targetId: string;
  count: number;
  viewerReaction: ReactionType | null;
  signedIn: boolean;
  size?: "md" | "sm";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [optimisticReaction, setOptimisticReaction] = useState(viewerReaction);
  const [optimisticCount, setOptimisticCount] = useState(count);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [pickerOpen]);

  // Auto-dismiss the error after a few seconds rather than leaving it stuck
  // next to the button forever (RECOMMENDATIONS item 117: it used to revert
  // the optimistic state on failure with no explanation at all).
  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timeout);
  }, [error]);

  function applyReaction(next: ReactionType | null) {
    if (pending) return;
    const previousReaction = optimisticReaction;
    const previousCount = optimisticCount;
    const delta = (next !== null ? 1 : 0) - (previousReaction !== null ? 1 : 0);
    setError(null);
    setOptimisticReaction(next);
    setOptimisticCount((c) => c + delta);
    setPickerOpen(false);
    startTransition(async () => {
      const result = await setReaction(targetType, targetId, next);
      if (result.error) {
        // Revert to the pre-click optimistic state, not the original
        // server-rendered `count`/`viewerReaction` props, which can be stale
        // after an earlier successful change in the same session.
        setOptimisticReaction(previousReaction);
        setOptimisticCount(previousCount);
        setError(result.error);
      }
    });
  }

  function handleTriggerClick() {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (optimisticReaction) {
      applyReaction(null);
      return;
    }
    setPickerOpen((open) => !open);
  }

  const active = optimisticReaction ? REACTIONS.find((r) => r.type === optimisticReaction) : null;
  const isSmall = size === "sm";

  return (
    <div ref={containerRef} className="relative">
      <motion.button
        type="button"
        onClick={handleTriggerClick}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={pickerOpen}
        aria-pressed={Boolean(optimisticReaction)}
        aria-label={active ? `Remove ${active.label} reaction` : "React"}
        whileTap={{ scale: 0.88 }}
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:opacity-70",
          isSmall ? "px-1.5 py-1 text-[11px]" : "px-2 py-1 text-xs",
          active ? "text-kivo-cyan" : "text-foreground-subtle hover:text-foreground-muted",
        )}
      >
        <motion.span
          key={active?.type ?? "none"}
          initial={{ scale: 0.5 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 600, damping: 12 }}
          className="flex items-center"
        >
          {active ? (
            <span className={isSmall ? "text-sm leading-none" : "text-base leading-none"}>{active.emoji}</span>
          ) : (
            <SmilePlus className={isSmall ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={1.75} />
          )}
        </motion.span>
        {optimisticCount > 0 ? optimisticCount : "React"}
      </motion.button>

      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            role="menu"
            aria-label="Choose a reaction"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="kivo-glass-sharp absolute bottom-full left-0 z-20 mb-2 flex items-center gap-0.5 rounded-xl p-1"
          >
            {REACTIONS.map((reaction) => (
              <button
                key={reaction.type}
                type="button"
                role="menuitem"
                aria-label={reaction.label}
                onClick={() => applyReaction(reaction.type)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-base leading-none transition-transform hover:scale-125 hover:bg-white/5"
              >
                {reaction.emoji}
              </button>
            ))}
          </motion.div>
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
            className="absolute top-full left-0 z-20 mt-1 w-max max-w-[14rem] text-[11px] text-critical"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
