"use client";

import { useState, useTransition } from "react";
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
      className="kivo-glass flex w-full max-w-sm flex-col gap-4 rounded-2xl p-5"
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
        {error && <span className="text-xs text-critical">{error}</span>}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="kivo-gradient-prime rounded-xl px-4 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Continue"}
      </button>

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
