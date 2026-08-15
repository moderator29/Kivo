"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion } from "motion/react";
import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { submitPrediction } from "@/app/(app)/predictions/actions";
import { PREDICTION_OUTCOME_LABEL, type PredictionOutcome as Outcome } from "@/lib/predictions";

type Team = { id: string | null; name: string; crest_url: string | null };

type PredictionCardProps = {
  fixtureId: string;
  kickoffAt: string;
  competitionName: string;
  homeTeam: Team;
  awayTeam: Team;
  initialPrediction: Outcome | null;
  signedIn: boolean;
};

export function PredictionCard({
  fixtureId,
  kickoffAt,
  competitionName,
  homeTeam,
  awayTeam,
  initialPrediction,
  signedIn,
}: PredictionCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [prediction, setPrediction] = useState<Outcome | null>(initialPrediction);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handlePick(outcome: Outcome) {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending || outcome === prediction) return;
    setError(null);
    const previous = prediction;
    setPrediction(outcome);
    startTransition(async () => {
      const result = await submitPrediction(fixtureId, outcome);
      if (result.error) {
        setPrediction(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-subtle">{competitionName}</span>
        <span className="text-xs text-foreground-subtle">
          {new Date(kickoffAt).toLocaleString(undefined, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <TeamCrest crestUrl={homeTeam.crest_url} name={homeTeam.name} />
          {homeTeam.id ? (
            <Link href={`/teams/${homeTeam.id}`} className="truncate text-sm text-foreground hover:text-kivo-cyan">
              {homeTeam.name}
            </Link>
          ) : (
            <span className="truncate text-sm text-foreground">{homeTeam.name}</span>
          )}
        </div>
        <span className="shrink-0 text-xs text-foreground-subtle">vs</span>
        <div className="flex flex-1 items-center justify-end gap-2">
          {awayTeam.id ? (
            <Link
              href={`/teams/${awayTeam.id}`}
              className="truncate text-right text-sm text-foreground hover:text-kivo-cyan"
            >
              {awayTeam.name}
            </Link>
          ) : (
            <span className="truncate text-right text-sm text-foreground">{awayTeam.name}</span>
          )}
          <TeamCrest crestUrl={awayTeam.crest_url} name={awayTeam.name} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {(["home_win", "draw", "away_win"] as const).map((outcome) => {
          const active = prediction === outcome;
          return (
            <motion.button
              key={outcome}
              type="button"
              disabled={pending}
              onClick={() => handlePick(outcome)}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className={`relative overflow-hidden rounded-lg border py-2 text-xs font-semibold transition-colors disabled:opacity-60 ${
                active ? "border-transparent" : "border-white/10 hover:bg-white/5"
              }`}
            >
              {active && (
                <motion.span
                  layoutId={`prediction-active-${fixtureId}`}
                  className="kivo-gradient-victory absolute inset-0"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <span className={`relative ${active ? "text-kivo-white" : "text-foreground-muted"}`}>
                {PREDICTION_OUTCOME_LABEL[outcome]}
              </span>
            </motion.button>
          );
        })}
      </div>

      {error && <p className="text-xs text-critical">{error}</p>}
    </div>
  );
}
