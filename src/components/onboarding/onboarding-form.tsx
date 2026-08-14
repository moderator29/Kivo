"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { completeOnboarding, skipOnboarding } from "@/app/onboarding/actions";

export function OnboardingForm({ defaultUsername }: { defaultUsername: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await completeOnboarding(formData);
          if (result?.error) setError(result.error);
        });
      }}
      className="kivo-glass-brand flex w-full max-w-sm flex-col gap-4 rounded-2xl p-5"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="username" className="text-xs font-medium text-foreground-muted">
          Username
        </label>
        <input
          id="username"
          name="username"
          required
          minLength={3}
          maxLength={24}
          pattern="[a-z0-9_]+"
          defaultValue={defaultUsername.startsWith("user_") ? "" : defaultUsername}
          placeholder="e.g. lagos_ultra"
          className="rounded-xl border border-white/10 bg-kivo-obsidian px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-subtle focus:border-kivo-blue focus:outline-none"
        />
        <AnimatePresence>
          {error && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="text-xs text-critical"
            >
              {error}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <motion.button
        type="submit"
        disabled={pending}
        whileHover={pending ? undefined : { scale: 1.02 }}
        whileTap={pending ? undefined : { scale: 0.97 }}
        className="kivo-gradient-prime rounded-xl px-4 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Continue"}
      </motion.button>

      <button
        type="button"
        formAction={() => startTransition(() => skipOnboarding())}
        className="text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground-muted"
      >
        Skip for now
      </button>
    </form>
  );
}
