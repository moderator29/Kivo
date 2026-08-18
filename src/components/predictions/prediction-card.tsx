"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Check, Lock } from "lucide-react";
import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";
import { submitPrediction } from "@/app/(app)/predictions/actions";
import { PREDICTION_OUTCOME_LABEL, type PredictionOutcome as Outcome } from "@/lib/predictions";
import { formatDeadlineCountdown } from "@/app/(app)/fantasy/fantasy-rules";
import { LocalDateTime } from "@/components/ui/relative-time";
import { GUEST_ACTION_TITLE, GuestLockHint } from "@/components/ui/guest-lock-hint";
import { cn } from "@/lib/utils";

const NEAR_LOCK_MS = 60 * 60_000;

// RECOMMENDATIONS.md item 168: "must be suppressed below a minimum sample
// size so a single vote never renders as 100% of users" — same real-sample
// threshold HeadToHeadCard already established (item 161) for the same
// reason, reused here rather than inventing a second honesty convention.
const MIN_MEANINGFUL_SAMPLE = 3;

export type PredictionConsensus = { home_win: number; draw: number; away_win: number };

/** Real per-outcome pick counts from get_prediction_consensus (SECURITY
 * DEFINER — predictions_select_own means a plain client query can never see
 * anyone else's pick). Renders nothing below MIN_MEANINGFUL_SAMPLE rather
 * than a misleading "100%" off one or two real picks. */
function ConsensusBar({ consensus }: { consensus: PredictionConsensus }) {
  const total = consensus.home_win + consensus.draw + consensus.away_win;
  if (total === 0) return null;
  if (total < MIN_MEANINGFUL_SAMPLE) {
    return (
      <p className="text-center text-[11px] text-foreground-subtle">
        {total} KIVO pick{total === 1 ? "" : "s"} so far. Too few for a real consensus yet.
      </p>
    );
  }

  const pct = (count: number) => Math.round((count / total) * 100);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-inset">
        <div className="h-full bg-accent" style={{ width: `${pct(consensus.home_win)}%` }} />
        <div className="h-full bg-hairline-strong" style={{ width: `${pct(consensus.draw)}%` }} />
        <div className="h-full bg-kivo-violet" style={{ width: `${pct(consensus.away_win)}%` }} />
      </div>
      <p className="text-center text-[11px] text-foreground-subtle">
        {pct(consensus.home_win)}% home · {pct(consensus.draw)}% draw · {pct(consensus.away_win)}% away · {total} real
        KIVO pick{total === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/**
 * Ticking lock state for a fixture's kickoff. Owned by PredictionCard (not
 * the countdown text alone) so the "locked" boolean that disables the pick
 * buttons and the "Predictions locked" text the countdown displays can never
 * disagree — they're computed from the same tick, once, rather than two
 * independent 30s intervals that could each flip a few seconds apart.
 */
function useLockState(kickoffAt: string) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const diffMs = new Date(kickoffAt).getTime() - now.getTime();
  const locked = diffMs <= 0;
  const nearLock = !locked && diffMs <= NEAR_LOCK_MS;

  return { now, locked, nearLock };
}

/**
 * "locks in Xh Ym" readout. Reuses fantasy-rules' formatDeadlineCountdown
 * directly rather than duplicating the day/hour/minute math (item 115:
 * predictions had no countdown and no near-lock warning at all before this).
 * Purely presentational — `now`/`locked`/`nearLock` come from the parent's
 * useLockState so this text can never contradict the pick buttons below it.
 */
function PredictionLockCountdown({
  kickoffAt,
  now,
  locked,
  nearLock,
}: {
  kickoffAt: string;
  now: Date;
  locked: boolean;
  nearLock: boolean;
}) {
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
  /** Real pick counts from get_prediction_consensus, or null when the RPC
   * returned nothing for this fixture (zero picks yet). RECOMMENDATIONS item
   * 168. */
  consensus?: PredictionConsensus | null;
};

export function PredictionCard({
  fixtureId,
  kickoffAt,
  competitionName,
  homeTeam,
  awayTeam,
  initialPrediction,
  signedIn,
  consensus = null,
}: PredictionCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [prediction, setPrediction] = useState<Outcome | null>(initialPrediction);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const { now, locked, nearLock } = useLockState(kickoffAt);

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
    if (pending || locked || outcome === prediction) return;
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
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-subtle">{competitionName}</span>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs text-foreground-subtle">
            <LocalDateTime iso={kickoffAt} format="weekdayTime" />
          </span>
          <PredictionLockCountdown kickoffAt={kickoffAt} now={now} locked={locked} nearLock={nearLock} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-2">
          <TeamCrest crestUrl={homeTeam.crest_url} name={homeTeam.name} />
          {homeTeam.id ? (
            <Link href={`/teams/${homeTeam.id}`} className="truncate text-sm text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
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
              className="truncate text-right text-sm text-foreground hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {awayTeam.name}
            </Link>
          ) : (
            <span className="truncate text-right text-sm text-foreground">{awayTeam.name}</span>
          )}
          <TeamCrest crestUrl={awayTeam.crest_url} name={awayTeam.name} />
        </div>
      </div>

      {locked ? (
        <div className="grid grid-cols-3 gap-2">
          {(["home_win", "draw", "away_win"] as const).map((outcome) => {
            const active = prediction === outcome;
            return (
              <div
                key={outcome}
                aria-label={active ? `You predicted ${PREDICTION_OUTCOME_LABEL[outcome]} — locked` : undefined}
                className={`relative flex items-center justify-center gap-1 overflow-hidden rounded-lg border py-3 text-xs font-semibold ${
                  active ? "border-transparent opacity-90" : "border-hairline opacity-40"
                }`}
              >
                {active && <span className="kivo-gradient-victory absolute inset-0" />}
                {active && <Lock className="relative h-3 w-3 shrink-0 text-on-accent" strokeWidth={2.5} />}
                <span className={`relative ${active ? "text-on-accent" : "text-foreground-muted"}`}>
                  {PREDICTION_OUTCOME_LABEL[outcome]}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {(["home_win", "draw", "away_win"] as const).map((outcome) => {
            const active = prediction === outcome;
            return (
              <motion.button
                key={outcome}
                type="button"
                disabled={pending}
                aria-busy={pending}
                aria-pressed={active}
                onClick={() => handlePick(outcome)}
                title={!signedIn ? GUEST_ACTION_TITLE : undefined}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className={`relative overflow-hidden rounded-lg border py-3 text-xs font-semibold transition-colors disabled:opacity-60 ${
                  active ? "border-transparent" : "border-hairline hover:bg-surface-2"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`}
              >
                {active && (
                  <motion.span
                    layoutId={`prediction-active-${fixtureId}`}
                    className="kivo-gradient-victory absolute inset-0"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={`relative flex items-center justify-center gap-1 ${active ? "text-on-accent" : "text-foreground-muted"}`}>
                  {/* RECOMMENDATIONS item 235 — same Lock glyph the locked
                      (post-deadline) branch above already uses for "you can't
                      act on this right now", reused here for "not signed in
                      yet" rather than a different glyph. */}
                  <GuestLockHint show={!signedIn} className="h-3 w-3 shrink-0" />
                  {PREDICTION_OUTCOME_LABEL[outcome]}
                </span>
              </motion.button>
            );
          })}
        </div>
      )}

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

      {consensus && <ConsensusBar consensus={consensus} />}
    </div>
  );
}
