"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowLeftRight } from "lucide-react";

export type CompareTeamOption = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
};

/**
 * Two native <select> dropdowns rather than a custom searchable combobox:
 * simple and reliable, and the browser already gives free type-ahead
 * jump-to-option search within a <select>. Pushes the chosen pair onto the
 * URL as ?a=&b= so the comparison itself stays server-rendered from real
 * search params rather than client state.
 */
export function TeamComparePicker({
  teams,
  initialA,
  initialB,
}: {
  teams: CompareTeamOption[];
  initialA?: string;
  initialB?: string;
}) {
  const router = useRouter();
  const [teamA, setTeamA] = useState(initialA ?? "");
  const [teamB, setTeamB] = useState(initialB ?? "");

  const canCompare = Boolean(teamA) && Boolean(teamB) && teamA !== teamB;

  function handleCompare() {
    if (!canCompare) return;
    router.push(`/teams/compare?a=${teamA}&b=${teamB}`);
  }

  return (
    <div className="kivo-glass-brand flex flex-col gap-5 rounded-2xl p-6">
      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="compare-team-a" className="text-xs font-medium text-foreground-muted">
            Team A
          </label>
          <select
            id="compare-team-a"
            value={teamA}
            onChange={(e) => setTeamA(e.target.value)}
            className="kivo-glass-sharp rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none kivo-focusable"
          >
            <option value="">Select a team</option>
            {teams
              .filter((t) => t.id !== teamB)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.country ? ` (${t.country})` : ""}
                </option>
              ))}
          </select>
        </div>

        <div className="hidden items-center justify-center pb-2.5 text-foreground-subtle sm:flex" aria-hidden="true">
          <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="compare-team-b" className="text-xs font-medium text-foreground-muted">
            Team B
          </label>
          <select
            id="compare-team-b"
            value={teamB}
            onChange={(e) => setTeamB(e.target.value)}
            className="kivo-glass-sharp rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none kivo-focusable"
          >
            <option value="">Select a team</option>
            {teams
              .filter((t) => t.id !== teamA)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.country ? ` (${t.country})` : ""}
                </option>
              ))}
          </select>
        </div>
      </div>

      {teamA && teamB && teamA === teamB && (
        <p className="text-center text-xs text-critical" role="status" aria-live="polite">
          Choose two different teams to compare.
        </p>
      )}

      <motion.button
        type="button"
        onClick={handleCompare}
        disabled={!canCompare}
        whileHover={canCompare ? { scale: 1.02 } : undefined}
        whileTap={canCompare ? { scale: 0.97 } : undefined}
        className="kivo-gradient-prime self-center rounded-xl px-6 py-2.5 text-sm font-semibold text-on-accent kivo-raise disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        Compare
      </motion.button>
    </div>
  );
}
