"use client";

import { useState, useTransition } from "react";
import { useAuth } from "@clerk/nextjs";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { deleteAccount } from "@/app/(app)/settings/actions";

const CONFIRM_PHRASE = "DELETE";

export function DeleteAccountSection() {
  const { signOut } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canConfirm = confirmText === CONFIRM_PHRASE && !pending;

  function handleDelete() {
    if (!canConfirm) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteAccount();
      if (result.error) {
        setError(result.error);
        return;
      }
      await signOut({ redirectUrl: "/" });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-critical" strokeWidth={1.75} />
        <p className="text-sm text-foreground-muted">
          Permanently deletes your KIVO account: your profile, posts, comments, predictions, fantasy teams and XP.
          This cannot be undone.
        </p>
      </div>

      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-fit items-center gap-2 rounded-xl border border-critical/30 bg-critical/10 px-5 py-2.5 text-sm font-semibold text-critical transition-colors hover:bg-critical/20"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
          Delete account
        </button>
      ) : (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-3 rounded-xl border border-critical/30 bg-critical/5 p-4"
          >
            <p className="text-xs text-foreground-muted">
              Type <span className="font-semibold text-foreground">{CONFIRM_PHRASE}</span> to confirm.
            </p>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              disabled={pending}
              className="rounded-lg border border-white/10 bg-kivo-obsidian px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-critical focus:outline-none disabled:opacity-50"
            />
            {error && <p className="text-xs text-critical">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canConfirm}
                aria-busy={pending}
                onClick={handleDelete}
                className="rounded-lg bg-critical px-4 py-2 text-xs font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {pending ? "Deleting…" : "Permanently delete my account"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setExpanded(false);
                  setConfirmText("");
                  setError(null);
                }}
                className="rounded-lg px-4 py-2 text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
