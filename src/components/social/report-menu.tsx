"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Flag, Check } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { reportContent } from "@/app/(app)/social/report-actions";
import { usePopoverPlacement } from "@/hooks/use-popover-placement";
import { GUEST_ACTION_TITLE, GuestLockHint } from "@/components/ui/guest-lock-hint";
import { cn } from "@/lib/utils";

const REPORT_REASONS = ["Spam", "Harassment or abuse", "Misinformation", "Inappropriate content", "Other"] as const;

/**
 * Reporting a post, as one control.
 *
 * This was inline in PostCard, which meant the Match Room's denser message row
 * had a choice between copying a hundred lines of popover logic and quietly
 * dropping the only moderation affordance a fan has. Neither is acceptable:
 * moderation, blocks and shadow-muting are already enforced in RLS, and the
 * way a reader reaches them must not depend on which surface they are reading.
 *
 * `compact` drops the word "Report" and keeps the flag. The label is worth its
 * width in a feed of considered takes; in a live room it is the third label on
 * a row that has to fit a phone, and the icon plus its accessible name carries
 * the same meaning. The tap target stays the same size either way.
 */
export function ReportMenu({
  targetId,
  signedIn,
  compact = false,
}: {
  targetId: string;
  signedIn: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [justReported, setJustReported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // RECOMMENDATIONS item 238: real viewport-edge collision detection for the
  // report-reason popover, which used to always render `right-0 bottom-full`
  // regardless of how close the trigger sat to the top of the viewport.
  // Estimated size covers the header row plus REPORT_REASONS.length rows in
  // the w-48 panel below.
  const placement = usePopoverPlacement(open, menuRef, {
    estimatedHeight: 40 + REPORT_REASONS.length * 32,
    estimatedWidth: 192,
    defaultVertical: "top",
    defaultHorizontal: "right",
  });

  useEffect(() => {
    if (!justReported) return;
    const timeout = setTimeout(() => setJustReported(false), 1600);
    return () => clearTimeout(timeout);
  }, [justReported]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Audit item 4: role="menu" popovers previously had no keyboard way to
    // close short of activating an item or tabbing past them. Escape closes
    // and returns focus to the trigger, matching the reaction picker.
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function handleClick() {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (reported || pending) return;
    setOpen((value) => !value);
  }

  function submitReport(reason: string) {
    if (reported || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await reportContent("post", targetId, reason);
      if (result.error) {
        setError(result.error);
        return;
      }
      setReported(true);
      setJustReported(true);
      setOpen(false);
    });
  }

  return (
    <div ref={menuRef} className="relative">
      <motion.button
        ref={triggerRef}
        type="button"
        onClick={handleClick}
        disabled={reported || pending}
        aria-haspopup={signedIn ? "menu" : undefined}
        aria-expanded={open}
        aria-label={reported ? "Reported" : "Report post"}
        title={!signedIn ? GUEST_ACTION_TITLE : undefined}
        whileTap={reported ? undefined : { scale: 0.88 }}
        className={cn(
          "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed",
          reported ? "text-foreground-subtle" : "text-foreground-subtle hover:text-critical",
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {justReported ? (
            <motion.span
              key="reported"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-1 text-live"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2} />
              {compact ? "" : "Reported"}
            </motion.span>
          ) : (
            <motion.span key="flag" className="flex items-center gap-1.5">
              <Flag className="h-3.5 w-3.5" strokeWidth={2} fill={reported ? "currentColor" : "none"} />
              {compact ? "" : reported ? "Reported" : "Report"}
              {/* RECOMMENDATIONS item 235 */}
              <GuestLockHint show={!signedIn} className="h-3 w-3 shrink-0 text-foreground-subtle" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Report reason"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "kivo-popover absolute z-20 w-48 overflow-hidden rounded-xl p-1",
              placement.vertical === "top" ? "bottom-full mb-2" : "top-full mt-2",
              placement.horizontal === "right" ? "right-0" : "left-0",
            )}
          >
            <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              Report this post
            </p>
            {REPORT_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                role="menuitem"
                disabled={pending}
                aria-busy={pending}
                onClick={() => submitReport(reason)}
                className="kivo-menu-item text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                {reason}
              </button>
            ))}
            {error && (
              <p className="px-2.5 py-1.5 text-[11px] text-critical" role="status" aria-live="polite">
                {error}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
