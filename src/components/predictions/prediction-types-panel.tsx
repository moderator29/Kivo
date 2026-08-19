"use client";

import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Info, Loader2, Trash2 } from "lucide-react";
import {
  CARDS_BAND_LABEL,
  CORNERS_BAND_LABEL,
  PREDICTION_TYPE_LABEL,
  PREDICTION_TYPE_POINTS,
  PREDICTION_TYPE_SOURCE,
  TOTAL_GOALS_BAND_LABEL,
  type CardsBand,
  type CornersBand,
  type PredictionPick,
  type PredictionType,
  type TotalGoalsBand,
} from "@/lib/predictions";
import {
  clearPrediction,
  loadFixturePredictionState,
  submitPrediction,
  type PredictionCandidate,
  type PredictionSubmission,
} from "@/app/(app)/predictions/actions";
import { RetryableError } from "@/components/ui/retryable-error";

/**
 * The five prediction types beyond "who wins", as a panel that opens on
 * demand.
 *
 * Collapsed by default, and lazily loaded, for two separate reasons that
 * happen to agree. The product reason: picking a winner is one tap and most
 * people want exactly that, so the fast path must not grow a scoreline
 * stepper and two squad lists in front of it. The engineering reason:
 * /predictions renders twenty of these cards, and eagerly fetching two squads
 * per card is roughly eight hundred player rows fetched to render panels
 * nobody opened.
 *
 * Every control writes immediately, matching the winner pills above it, and
 * every group states in one line what will actually settle it — see
 * PREDICTION_TYPE_SOURCE. A fan is entitled to know that "cards & corners"
 * turns on a statistics feed that may not arrive, and that "man of the match"
 * is settled by this Room's own vote rather than by a provider award KIVO
 * does not have.
 */

const EXTRA_TYPES: PredictionType[] = ["correct_score", "total_goals", "first_scorer", "cards_corners", "motm"];

type PanelState = {
  candidates: PredictionCandidate[];
  homeTeamId: string;
  awayTeamId: string;
  picks: PredictionPick[];
};

export function PredictionTypesPanel({
  fixtureId,
  homeTeamName,
  awayTeamName,
  signedIn,
  locked,
}: {
  fixtureId: string;
  homeTeamName: string;
  awayTeamName: string;
  signedIn: boolean;
  locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PanelState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  async function load() {
    setLoading(true);
    setError(null);
    const result = await loadFixturePredictionState(fixtureId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setState({
      candidates: result.candidates,
      homeTeamId: result.homeTeamId,
      awayTeamId: result.awayTeamId,
      picks: result.picks,
    });
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !state && !loading) void load();
  }

  function pickFor(type: PredictionType): PredictionPick | null {
    return state?.picks.find((pick) => pick.type === type) ?? null;
  }

  function save(submission: PredictionSubmission) {
    setError(null);
    startSaving(async () => {
      const result = await submitPrediction(fixtureId, submission);
      if (result.error) {
        setError(result.error);
        return;
      }
      await load();
    });
  }

  function remove(type: PredictionType) {
    setError(null);
    startSaving(async () => {
      const result = await clearPrediction(fixtureId, type);
      if (result.error) {
        setError(result.error);
        return;
      }
      await load();
    });
  }

  const madeCount = state?.picks.filter((pick) => pick.type !== "winner").length ?? 0;

  return (
    <div className="flex flex-col border-t border-hairline-soft pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="kivo-focus flex items-center justify-between gap-3 rounded-xl px-1 py-1 text-left text-xs font-medium text-foreground-muted transition-colors hover:text-foreground"
      >
        <span>
          {madeCount > 0 ? `${madeCount} more prediction${madeCount === 1 ? "" : "s"} made` : "5 more ways to call this"}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-4 pt-3">
              {loading && !state && (
                <p className="flex items-center gap-2 text-xs text-foreground-subtle">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  Loading squads…
                </p>
              )}

              {error && <RetryableError message={error} retrying={loading || saving} onRetry={() => void load()} />}

              {state &&
                EXTRA_TYPES.map((type) => (
                  <TypeGroup
                    key={type}
                    type={type}
                    pick={pickFor(type)}
                    state={state}
                    homeTeamName={homeTeamName}
                    awayTeamName={awayTeamName}
                    disabled={locked || saving || !signedIn}
                    onSave={save}
                    onClear={() => remove(type)}
                  />
                ))}

              {state && locked && (
                <p className="text-[11px] text-foreground-subtle">
                  This match has kicked off, so these are locked in as they stand.
                </p>
              )}
              {state && !signedIn && (
                <p className="text-[11px] text-foreground-subtle">Sign up to make these predictions.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TypeGroup({
  type,
  pick,
  state,
  homeTeamName,
  awayTeamName,
  disabled,
  onSave,
  onClear,
}: {
  type: PredictionType;
  pick: PredictionPick | null;
  state: PanelState;
  homeTeamName: string;
  awayTeamName: string;
  disabled: boolean;
  onSave: (submission: PredictionSubmission) => void;
  onClear: () => void;
}) {
  // The two player-naming types are only offerable when KIVO has really
  // synced at least one of the two squads. An empty dropdown that looks
  // pickable is worse than saying plainly that the squads are not in yet.
  const needsSquad = type === "first_scorer" || type === "motm";
  const squadMissing = needsSquad && state.candidates.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-foreground">{PREDICTION_TYPE_LABEL[type]}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-foreground-subtle">{PREDICTION_TYPE_POINTS[type]} pts</span>
          {pick && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              aria-label={`Remove your ${PREDICTION_TYPE_LABEL[type].toLowerCase()} prediction`}
              className="kivo-focus rounded-md p-1 text-foreground-subtle transition-colors hover:text-critical disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" strokeWidth={2} />
            </button>
          )}
        </span>
      </div>

      {squadMissing ? (
        <p className="flex items-start gap-1.5 text-[11px] text-warning">
          <Info className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
          KIVO hasn&apos;t synced either squad for this match yet, so there are no real players to pick from.
        </p>
      ) : (
        <>
          {type === "correct_score" && (
            <CorrectScorePicker
              homeTeamName={homeTeamName}
              awayTeamName={awayTeamName}
              homeScore={pick?.homeScore ?? null}
              awayScore={pick?.awayScore ?? null}
              disabled={disabled}
              onSave={(homeScore, awayScore) => onSave({ type: "correct_score", homeScore, awayScore })}
            />
          )}

          {type === "total_goals" && (
            <BandPills
              options={Object.entries(TOTAL_GOALS_BAND_LABEL) as [TotalGoalsBand, string][]}
              value={pick?.totalGoals ?? null}
              disabled={disabled}
              onPick={(band) => onSave({ type: "total_goals", band })}
            />
          )}

          {type === "cards_corners" && (
            <div className="flex flex-col gap-1.5">
              <BandPills
                options={Object.entries(CARDS_BAND_LABEL) as [CardsBand, string][]}
                value={pick?.cards ?? null}
                disabled={disabled}
                onPick={(cards) => onSave({ type: "cards_corners", cards, corners: pick?.corners ?? "corners_9_12" })}
              />
              <BandPills
                options={Object.entries(CORNERS_BAND_LABEL) as [CornersBand, string][]}
                value={pick?.corners ?? null}
                disabled={disabled}
                onPick={(corners) => onSave({ type: "cards_corners", cards: pick?.cards ?? "cards_3_4", corners })}
              />
            </div>
          )}

          {needsSquad && (
            <PlayerPicker
              candidates={state.candidates}
              homeTeamId={state.homeTeamId}
              homeTeamName={homeTeamName}
              awayTeamName={awayTeamName}
              value={pick?.playerId ?? null}
              disabled={disabled}
              onPick={(playerId) =>
                onSave(type === "first_scorer" ? { type: "first_scorer", playerId } : { type: "motm", playerId })
              }
            />
          )}
        </>
      )}

      <p className="text-[10px] leading-relaxed text-foreground-subtle">{PREDICTION_TYPE_SOURCE[type]}</p>
    </div>
  );
}

function BandPills<T extends string>({
  options,
  value,
  disabled,
  onPick,
}: {
  options: [T, string][];
  value: T | null;
  disabled: boolean;
  onPick: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {options.map(([band, label]) => {
        const active = value === band;
        return (
          <button
            key={band}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onPick(band)}
            className={`kivo-focus rounded-xl border px-2 py-2 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
              active
                ? "border-transparent bg-accent-strong text-on-accent"
                : "border-hairline text-foreground-muted hover:bg-surface-2"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** A scoreline picker, capped at the range a real match plausibly reaches.
 * 0-7 covers every professional result KIVO will ever sync while keeping the
 * control to two taps rather than a free-text field that has to be validated
 * against migration 0079's 0-20 constraint. */
const SCORE_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7];

function CorrectScorePicker({
  homeTeamName,
  awayTeamName,
  homeScore,
  awayScore,
  disabled,
  onSave,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number | null;
  awayScore: number | null;
  disabled: boolean;
  onSave: (homeScore: number, awayScore: number) => void;
}) {
  // Held locally so a half-entered scoreline (home chosen, away not yet)
  // never gets written — the server would reject it via
  // predictions_payload_matches_type anyway, and a rejection the user caused
  // by tapping one of two required controls is not an error worth showing.
  const [home, setHome] = useState<number | null>(homeScore);
  const [away, setAway] = useState<number | null>(awayScore);

  function update(nextHome: number | null, nextAway: number | null) {
    setHome(nextHome);
    setAway(nextAway);
    if (nextHome !== null && nextAway !== null) onSave(nextHome, nextAway);
  }

  return (
    <div className="flex items-center gap-2">
      <ScoreSelect
        label={`${homeTeamName} goals`}
        value={home}
        disabled={disabled}
        onChange={(value) => update(value, away)}
      />
      <span className="shrink-0 text-xs text-foreground-subtle">-</span>
      <ScoreSelect
        label={`${awayTeamName} goals`}
        value={away}
        disabled={disabled}
        onChange={(value) => update(home, value)}
      />
    </div>
  );
}

function ScoreSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className="kivo-focus min-w-0 flex-1 rounded-xl border border-hairline bg-surface-inset px-3 py-2 text-xs text-foreground disabled:opacity-50"
    >
      <option value="" disabled>
        —
      </option>
      {SCORE_CHOICES.map((choice) => (
        <option key={choice} value={choice}>
          {choice}
        </option>
      ))}
    </select>
  );
}

/**
 * Grouped by real club, from `players.current_team_id`. A native select with
 * optgroups rather than a bespoke combobox: at 390px it opens the platform's
 * own full-height picker, it is keyboard- and screen-reader-correct without
 * any work, and a squad list is exactly the shape a select is good at.
 */
function PlayerPicker({
  candidates,
  homeTeamId,
  homeTeamName,
  awayTeamName,
  value,
  disabled,
  onPick,
}: {
  candidates: PredictionCandidate[];
  homeTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  value: string | null;
  disabled: boolean;
  onPick: (playerId: string) => void;
}) {
  const home = candidates.filter((candidate) => candidate.teamId === homeTeamId);
  const away = candidates.filter((candidate) => candidate.teamId !== homeTeamId);

  return (
    <select
      aria-label="Player"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onPick(event.target.value)}
      className="kivo-focus w-full rounded-xl border border-hairline bg-surface-inset px-3 py-2 text-xs text-foreground disabled:opacity-50"
    >
      <option value="" disabled>
        Pick a player
      </option>
      {home.length > 0 && (
        <optgroup label={homeTeamName}>
          {home.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </optgroup>
      )}
      {away.length > 0 && (
        <optgroup label={awayTeamName}>
          {away.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
