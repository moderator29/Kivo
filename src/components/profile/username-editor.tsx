"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Pencil, Check, X } from "lucide-react";
import { updateUsername, checkUsernameAvailable } from "@/app/(app)/profile/actions";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const AVAILABILITY_DEBOUNCE_MS = 450;

export function UsernameEditor({ username }: { username: string }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const [draft, setDraft] = useState(username);
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const availabilityRequestId = useRef(0);
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  // Debounced from the onChange handler itself rather than a `draft` effect
  // — an effect would need to call setAvailability("idle") synchronously for
  // an invalid/unchanged candidate, which is exactly the "derive state via
  // effect" anti-pattern (see https://react.dev/learn/you-might-not-need-an-effect).
  // Driving it from the event handler keeps every setAvailability call
  // inside a callback (this handler, the debounce timer, or the check's
  // response), never synchronously inside an effect body.
  function handleDraftChange(rawValue: string) {
    // Same normalise-on-input fix as onboarding-flow.tsx: the server and the
    // availability check both lowercase, but `pattern="[a-z0-9_]+"` on the
    // input rejects the raw uppercase, so a handle could read "Available"
    // and still refuse to submit. Fold case on the way in so what's shown is
    // what's stored.
    const value = rawValue.toLowerCase();
    setDraft(value);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

    const candidate = value.trim();
    if (!USERNAME_PATTERN.test(candidate)) {
      setAvailability("idle");
      return;
    }
    // Re-typing the username unchanged is always fine — no need to round-trip.
    if (candidate === username.toLowerCase()) {
      setAvailability("idle");
      return;
    }

    setAvailability("checking");
    const requestId = ++availabilityRequestId.current;
    debounceTimeout.current = setTimeout(() => {
      checkUsernameAvailable(candidate).then((result) => {
        if (availabilityRequestId.current !== requestId) return;
        setAvailability(result.available === null ? "idle" : result.available ? "available" : "taken");
      });
    }, AVAILABILITY_DEBOUNCE_MS);
  }

  // Only cleans up the pending timer on unmount — never calls setState, so
  // this doesn't trip the "no setState directly in an effect" rule above.
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    };
  }, []);

  if (!editing) {
    return (
      <span className="flex items-center gap-2">
        <button
          onClick={() => {
            setDraft(username);
            setAvailability("idle");
            setEditing(true);
          }}
          className="flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          @{username}
          <Pencil className="h-3 w-3" strokeWidth={2} />
        </button>
        <AnimatePresence>
          {justSaved && (
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-1 text-xs font-medium text-live"
            >
              <Check className="h-3 w-3" strokeWidth={2} />
              Saved
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    );
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await updateUsername(formData);
          if (result.error) setError(result.error);
          else {
            setEditing(false);
            setJustSaved(true);
          }
        });
      }}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <input
            name="username"
            value={draft}
            onChange={(e) => handleDraftChange(e.target.value)}
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]+"
            autoFocus
            className="rounded-lg border border-hairline bg-background px-2 py-1 pr-6 text-sm text-foreground focus:border-accent-strong focus:outline-none"
          />
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2">
            {availability === "checking" && (
              <span className="block h-3 w-3 animate-spin rounded-full border-2 border-foreground-subtle/30 border-t-foreground-subtle" />
            )}
            {availability === "available" && <Check className="h-3 w-3 text-live" strokeWidth={2} />}
            {availability === "taken" && <X className="h-3 w-3 text-critical" strokeWidth={2} />}
          </span>
        </div>
        <button
          type="submit"
          disabled={pending || availability === "taken"}
          aria-busy={pending}
          className="text-live disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label="Save"
        >
          <Check className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(username);
            setEditing(false);
          }}
          className="text-foreground-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      <span role="status" aria-live="polite">
        {error ? (
          <span className="text-xs text-critical">{error}</span>
        ) : availability === "taken" ? (
          <span className="text-xs text-critical">Taken. Try another.</span>
        ) : availability === "available" ? (
          <span className="text-xs text-live">Available</span>
        ) : null}
      </span>
    </form>
  );
}
