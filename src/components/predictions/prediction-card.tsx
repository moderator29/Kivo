"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { submitPrediction } from "@/app/(app)/predictions/actions";
import { PREDICTION_OUTCOME_LABEL, type PredictionOutcome as Outcome } from "@/lib/predictions";
import { formatDeadlineCountdown } from "@/app/(app)/fantasy/fantasy-rules";
import { cn } from "@/lib/utils";

const NEAR_LOCK_MS = 60 * 60_000;

/**
 * Ticking "locks in Xh Ym" readout, ownership pattern matches fantasy's
 * DeadlineCountdown (RECOMMENDATIONS item 83): a leaf with its own 30s
 * interval so only this string re-renders, not the whole card. Reuses
 * fantasy-rules' formatDeadlineCountdown directly rather than duplicating
 * the day/hour/minute math (item 115: predictions had no countdown and no
 * near-lock warning at all before this).
 */
function PredictionLockCountdown({ kickoffAt }: { kickoffAt: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const diffMs = new Date(kickoffAt).getTime() - now.getTime();
  const locked = diffMs <= 0;
  const nearLock = !locked && diffMs <= NEAR_LOCK_MS;

  return (
    <span className={cn("text-[11px] font-medium", nearLock ? "text-critical" : "text-foreground-subtle")}>
      {locked ? "Predictions locked" : `Locks in ${formatDeadlineCountdown(kickoffAt, now)}`}
    </span>
  );
}

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
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // Transient confirmation moment (RECOMMENDATIONS item 114), same
  // auto-dismiss pattern as UsernameEditor's "Saved" check: picking a pill
  // used to change nothing else on screen, so there was no feedback that
  // the pick had actually been written anywhere.
  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  function handlePick(outcome: Outcome) {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending || outcome === prediction) return;
    setError(null);
    setJustSaved(false);
    const previous = prediction;
    setPrediction(outcome);
    startTransition(async () => {
      const result = await submitPrediction(fixtureId, outcome);
      if (result.error) {
        setPrediction(previous);
        setError(result.error);
      } else {
        setJustSaved(true);
      }
    });
  }

  return (
    <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-foreground-subtle">{competitionName}</span>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-xs text-foreground-subtle">
            {new Date(kickoffAt).toLocaleString(undefined, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <PredictionLockCountdown kickoffAt={kickoffAt} />
        </div>
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
              aria-busy={pending}
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

      <AnimatePresence>
        {error ? (
          <motion.p
            key="error"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-xs text-critical"
            role="status"
            aria-live="polite"
          >
            {error}
          </motion.p>
        ) : justSaved ? (
          <motion.p
            key="saved"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-1 text-xs font-medium text-live"
            role="status"
            aria-live="polite"
          >
            <Check className="h-3 w-3" strokeWidth={2.5} />
            Prediction saved
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
