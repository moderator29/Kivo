"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check } from "lucide-react";

/**
 * The bottom of every profile-editing page: one full-width pill that commits
 * the change, and one place errors and confirmation appear.
 *
 * Saving is deliberately an explicit act here. The pickers this replaces wrote
 * to the database the instant a thumbnail was tapped, which meant there was no
 * moment where a user had chosen something but not yet committed to it — no
 * way to compare two options, and no way to change their mind. Every page
 * using this bar holds the choice locally until this button is pressed.
 *
 * The confirmation is a state, not a toast: after a successful save the button
 * itself says so and a way back to the profile appears next to it, so the flow
 * ends somewhere rather than leaving the user on a form they have finished
 * with.
 */
export function ProfileSaveBar({
  pending,
  disabled,
  saved,
  error,
  label = "Save",
  backHref = "/profile",
  backLabel = "Back to profile",
}: {
  pending: boolean;
  disabled: boolean;
  saved: boolean;
  error: string | null;
  label?: string;
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span role="status" aria-live="polite" className="min-h-4 text-center text-xs">
        {error ? (
          <span className="text-critical">{error}</span>
        ) : (
          <AnimatePresence>
            {saved && (
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center justify-center gap-1 font-medium text-live"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
                Saved
              </motion.span>
            )}
          </AnimatePresence>
        )}
      </span>

      <button
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending}
        className="kivo-gradient-prime kivo-focus kivo-raise w-full rounded-xl px-5 py-3 text-sm font-semibold text-on-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Saving…" : label}
      </button>

      {saved && (
        <Link
          href={backHref}
          className="kivo-focus text-center text-xs font-semibold text-foreground-muted hover:text-foreground"
        >
          {backLabel}
        </Link>
      )}
    </div>
  );
}
