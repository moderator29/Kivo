"use client";

import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import { saveUsernameStep, finishOnboarding, skipOnboarding } from "@/app/onboarding/actions";
import { TeamCrest } from "@/components/ui/team-crest";

type Team = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
};

export function OnboardingForm({
  defaultUsername,
  availableTeams,
}: {
  defaultUsername: string;
  availableTeams: Team[];
}) {
  const [step, setStep] = useState<"username" | "team">("username");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  function handleUsernameSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveUsernameStep(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (availableTeams.length > 0) {
        setStep("team");
      } else {
        await finishOnboarding(null);
      }
    });
  }

  function handleFinish(teamId: string | null) {
    startTransition(() => finishOnboarding(teamId));
  }

  if (step === "team") {
    return (
      <div className="kivo-glass-brand flex w-full max-w-sm flex-col gap-4 rounded-2xl p-5">
        <div className="flex flex-col gap-1.5 text-center">
          <h1 className="text-lg font-semibold text-foreground">Who do you support?</h1>
          <p className="text-xs text-foreground-muted">
            Optional, but it&apos;s what makes Home and the AI Copilot feel like yours. You can change it anytime.
          </p>
        </div>

        <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
          {availableTeams.map((team) => {
            const isSelected = selectedTeamId === team.id;
            return (
              <button
                key={team.id}
                type="button"
                disabled={pending}
                onClick={() => setSelectedTeamId(team.id)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors disabled:opacity-50 ${
                  isSelected
                    ? "border-kivo-cyan/60 bg-kivo-cyan/10 text-foreground"
                    : "border-white/10 bg-kivo-obsidian text-foreground-muted hover:border-white/20"
                }`}
              >
                <TeamCrest crestUrl={team.crest_url} name={team.name} size={20} />
                <span className="truncate">{team.short_name ?? team.name}</span>
                {isSelected && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-kivo-cyan" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>

        <motion.button
          type="button"
          disabled={pending || !selectedTeamId}
          onClick={() => handleFinish(selectedTeamId)}
          whileHover={pending || !selectedTeamId ? undefined : { scale: 1.02 }}
          whileTap={pending || !selectedTeamId ? undefined : { scale: 0.97 }}
          className="kivo-gradient-prime rounded-xl px-4 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Continue"}
        </motion.button>

        <button
          type="button"
          disabled={pending}
          onClick={() => handleFinish(null)}
          className="text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
        >
          Skip for now
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-center">
      <FadeInHeading />
      <form
        action={handleUsernameSubmit}
        className="kivo-glass-brand mt-4 flex w-full max-w-sm flex-col gap-4 rounded-2xl p-5 text-left"
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
          disabled={pending}
          onClick={() => startTransition(() => skipOnboarding())}
          className="text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
        >
          Skip for now
        </button>
      </form>
    </div>
  );
}

function FadeInHeading() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-1.5"
    >
      <h1 className="text-lg font-semibold text-foreground">Pick your KIVO handle</h1>
      <p className="text-xs text-foreground-muted">
        This is how other fans will see you in Match Rooms and the feed. You can change it later.
      </p>
    </motion.div>
  );
}
