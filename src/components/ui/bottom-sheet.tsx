"use client";

import { useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";
import { ViewportPortal } from "@/components/ui/viewport-portal";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { cn } from "@/lib/utils";

/**
 * The app's one bottom sheet.
 *
 * KIVO had exactly one sheet before this — `PlayerActionSheet` in
 * `src/app/(app)/fantasy/player-action-sheet.tsx` — and every part of it that
 * is *sheet* rather than *fantasy* is repeated here: the non-focusable
 * backdrop (RECOMMENDATIONS item 149, a real `<button>` there put an
 * unlabelled control ahead of the dialog's own content in reading order), the
 * grabber, the `kivo-popover` tier because a sheet floats over content and has
 * to stay opaque in both themes, the spring from the design system's
 * "interactive chrome" vocabulary, and the safe-area inset that keeps the
 * panel clear of a phone's home indicator.
 *
 * Two things it adds that the fantasy one could do without, and that a
 * general sheet cannot:
 *
 * - **A portal.** `ViewportPortal` exists because an ancestor with a
 *   `transform`/`filter`/`backdrop-filter` becomes the containing block for
 *   `position: fixed`, and every page body in this app sits inside an
 *   animating `motion.div`. The fantasy sheet gets away without one because
 *   its own ancestor happens not to transform; a sheet opened from anywhere
 *   would not.
 * - **A scroll boundary.** The body scrolls inside `max-h`, so a long list
 *   cannot push the sheet's own header or footer off the screen, and the
 *   sticky footer stays a footer rather than becoming the end of a list.
 *
 * Deliberately not a drag-to-dismiss sheet. Drag-to-dismiss on a scrollable
 * body needs gesture arbitration between the drag and the scroll to not feel
 * broken, and a sheet that sometimes eats a scroll is worse than one that
 * closes from a backdrop tap, an X and Escape — all three of which this has.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  /** One line under the title. Say what choosing something here does. */
  description,
  /** Pinned below the scroll area — REF A's full-width primary action. */
  footer,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef, onClose);

  return (
    <ViewportPortal>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex flex-col justify-end"
          >
            <div aria-hidden="true" className="absolute inset-0 bg-overlay backdrop-blur-sm" onClick={onClose} />
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              initial={{ y: 28, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 28, opacity: 0 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className={cn(
                "kivo-popover relative z-10 mx-auto flex max-h-[86svh] w-full max-w-lg flex-col rounded-t-3xl pt-2.5 sm:mx-3 sm:mb-[calc(env(safe-area-inset-bottom)+16px)] sm:rounded-3xl",
                className,
              )}
            >
              <div aria-hidden="true" className="mx-auto h-1 w-9 shrink-0 rounded-full bg-hairline-strong" />

              <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
                  {description && <p className="text-xs leading-relaxed text-foreground-subtle">{description}</p>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="kivo-focus flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground-subtle transition hover:text-foreground"
                >
                  <X className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>

              {/* The safe-area inset lives on the scroll body when there is no
                  footer, so the last row of a list never sits under a phone's
                  home indicator. With a footer, the footer owns it instead. */}
              <div
                className={cn(
                  "min-h-0 flex-1 overflow-y-auto overscroll-contain px-4",
                  footer ? "pb-4" : "pb-[calc(env(safe-area-inset-bottom)+16px)] sm:pb-4",
                )}
              >
                {children}
              </div>

              {footer && (
                <div className="shrink-0 border-t border-hairline-soft px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 sm:pb-3">
                  {footer}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ViewportPortal>
  );
}
