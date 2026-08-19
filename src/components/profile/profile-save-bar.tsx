"use client";

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
 * The confirmation is a state, not a toast: after a successful save the bar
 * itself says so, and then the form takes the user back where they came from
 * (`useSaveReturn`, called by each form's own success branch). It used to
 * offer a "Back to profile" link at that moment instead — which was the
 * founder's complaint in as many words: "when I click save it should auto save
 * and take me back to the previous page, not that go back button". A link that
 * appears after a save is another thing to press at the moment the errand is
 * already over.
 *
 * The confirmation is held on screen for `SAVE_RETURN_DELAY_MS` before the
 * navigation, so "Saved" is something the user reads rather than something
 * that happens behind a page transition. The page's own back control is
 * untouched and still leaves without saving.
 */
export function ProfileSaveBar({
  pending,
  disabled,
  saved,
  error,
  label = "Save",
}: {
  pending: boolean;
  disabled: boolean;
  saved: boolean;
  error: string | null;
  label?: string;
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
    </div>
  );
}
