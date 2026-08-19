"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";

export type CompareTeamOption = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
};

const SLOTS = [
  { id: "a", label: "Team A", optional: false },
  { id: "b", label: "Team B", optional: false },
  { id: "c", label: "Team C (optional)", optional: true },
] as const;

/**
 * Native <select> dropdowns rather than a custom searchable combobox: simple
 * and reliable, and the browser already gives free type-ahead jump-to-option
 * search within a <select>. Pushes the chosen teams onto the URL as ?a=&b=&c=
 * so the comparison itself stays server-rendered from real search params
 * rather than client state.
 *
 * ## The third slot
 *
 * Two is the minimum and three is the ceiling. Two because a comparison of one
 * is a profile; three because the columns still fit a phone at a readable size
 * and a fourth does not — and because a mid-table club is usually being
 * measured against the team above it and the team below it, which is exactly
 * three.
 *
 * C is optional and appended to the URL only when chosen, so every existing
 * two-team link keeps working untouched and a shared three-team link keeps its
 * third column.
 *
 * The swap arrow that used to sit between A and B is gone. It was decoration
 * (aria-hidden) that only made sense for a pair, and keeping it would have
 * meant an asymmetric layout implying B and C are somehow a unit.
 */
export function TeamComparePicker({
  teams,
  initialA,
  initialB,
  initialC,
}: {
  teams: CompareTeamOption[];
  initialA?: string;
  initialB?: string;
  initialC?: string;
}) {
  const router = useRouter();
  const [teamA, setTeamA] = useState(initialA ?? "");
  const [teamB, setTeamB] = useState(initialB ?? "");
  const [teamC, setTeamC] = useState(initialC ?? "");

  const chosen = [teamA, teamB, teamC].filter(Boolean);
  const allDistinct = new Set(chosen).size === chosen.length;
  const canCompare = Boolean(teamA) && Boolean(teamB) && allDistinct;

  function handleCompare() {
    if (!canCompare) return;
    const params = new URLSearchParams({ a: teamA, b: teamB });
    if (teamC) params.set("c", teamC);
    router.push(`/teams/compare?${params.toString()}`);
  }

  return (
    <div className="kivo-glass-brand flex flex-col gap-5 rounded-2xl p-6">
      <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
        {SLOTS.map((slot) => {
          const value = slot.id === "a" ? teamA : slot.id === "b" ? teamB : teamC;
          const setValue = slot.id === "a" ? setTeamA : slot.id === "b" ? setTeamB : setTeamC;
          return (
            <div key={slot.id} className="flex flex-col gap-1.5">
              <label htmlFor={`compare-team-${slot.id}`} className="text-xs font-medium text-foreground-muted">
                {slot.label}
              </label>
              <select
                id={`compare-team-${slot.id}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="kivo-glass-sharp rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none kivo-focusable"
              >
                <option value="">{slot.optional ? "None" : "Select a team"}</option>
                {teams
                  // A team already picked in another slot is not offered here,
                  // which is what keeps "three different teams" true by
                  // construction rather than by validation after the fact.
                  .filter((t) => t.id === value || ![teamA, teamB, teamC].includes(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {t.country ? ` (${t.country})` : ""}
                    </option>
                  ))}
              </select>
            </div>
          );
        })}
      </div>

      {!allDistinct && (
        <p className="text-center text-xs text-critical" role="status" aria-live="polite">
          Choose different teams for each slot.
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
