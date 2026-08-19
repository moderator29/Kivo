"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { Copy, Check, Clock, Plus, History, Compass, Crown } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { LocalDateTime } from "@/components/ui/relative-time";
import { setGameweekRoster, setFantasyCaptain, type FantasyPlayerSearchResult } from "./actions";
import { FantasyLeaderboard, type LeaderboardEntry } from "./fantasy-leaderboard";
import { HowScoringWorks } from "./how-scoring-works";
import { StatTile, PitchLines, PlayerToken } from "./pitch";
import { PlayerActionSheet } from "./player-action-sheet";
import { RetryableError } from "@/components/ui/retryable-error";
import { PlayerPicker } from "./player-picker";
import { DeadlineCountdown } from "./deadline-countdown";
import {
  POSITION_GROUPS,
  SQUAD_RULES,
  SQUAD_SIZE,
  FANTASY_BUDGET_CAP,
  formatFantasyPrice,
  validateRoster,
  type PositionGroup,
  type PositionGroupOrOther,
} from "./fantasy-rules";

export type RosterEntry = {
  playerId: string;
  name: string;
  position: string | null;
  positionGroup: PositionGroupOrOther;
  teamName: string | null;
  teamCrestUrl: string | null;
  price: number;
  isStarting: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
};

type LeagueInfo = {
  id: string;
  name: string;
  isPrivate: boolean;
  inviteCode: string | null;
  maxTeams: number;
  teamCount: number;
  seasonId: string;
};

type GameweekInfo = { id: string; number: number; deadlineAt: string };

type FantasyBuilderProps = {
  teams: { id: string; name: string }[];
  activeTeamId: string;
  league: LeagueInfo;
  gameweek: GameweekInfo | null;
  initialRoster: RosterEntry[];
  points: number | null;
  pointsAvailable: boolean;
  leaderboard: { entries: LeaderboardEntry[]; hasAnyScores: boolean };
  /** RECOMMENDATIONS.md item 295: the viewer's own real fantasy_points row
   * per scored gameweek for activeTeamId, ascending by gameweek number —
   * see PointsByGameweekStrip in fantasy-leaderboard.tsx. */
  pointsHistory: { gameweekNumber: number; points: number }[];
  /** Set only on the page load where a previous gameweek's squad was just
   * copied forward into this one — see carryForwardFantasyRoster. Deliberately
   * transient (not re-derived on every later load) so it reads as "here's why
   * your squad wasn't empty just now" rather than a permanent label. */
  carriedForwardFromGameweek: number | null;
};

const VIEW_TABS = ["Squad", "Leaderboard"] as const;
type ViewTab = (typeof VIEW_TABS)[number];

function viewTabId(tab: ViewTab): string {
  return `fantasy-view-tab-${tab.toLowerCase()}`;
}

function viewPanelId(tab: ViewTab): string {
  return `fantasy-view-panel-${tab.toLowerCase()}`;
}

// Pitch renders attacking end at the top: Forwards, Midfielders, Defenders,
// Goalkeepers — mirrors the usual fantasy-app orientation.
const PITCH_ROWS: PositionGroup[] = ["Forwards", "Midfielders", "Defenders", "Goalkeepers"];

function rosterSignature(list: RosterEntry[]) {
  return list
    .map((p) => `${p.playerId}:${p.isStarting}`)
    .sort()
    .join(",");
}

/**
 * Whether `deadlineAt` has already passed, updated exactly once — right when
 * the deadline itself arrives — via a single `setTimeout` rather than a
 * recurring interval (RECOMMENDATIONS item 83). `locked` gates real
 * interactive state (Save, captaincy, the picker) so it still needs to be
 * known here at the FantasyBuilder level, unlike the countdown *text*, which
 * is cosmetic-only and now lives in the DeadlineCountdown leaf below.
 */
function computeDeadlinePassed(deadlineAt: string | null): boolean {
  return !deadlineAt || new Date(deadlineAt) <= new Date();
}

function useDeadlinePassed(deadlineAt: string | null): boolean {
  const [passed, setPassed] = useState(() => computeDeadlinePassed(deadlineAt));

  // React's documented "adjusting state when a prop changes" pattern (same
  // one NotificationBell already uses) — recompute synchronously during
  // render, not in an effect, whenever `deadlineAt` itself changes (a
  // different gameweek/team selected).
  const [prevDeadlineAt, setPrevDeadlineAt] = useState(deadlineAt);
  if (deadlineAt !== prevDeadlineAt) {
    setPrevDeadlineAt(deadlineAt);
    setPassed(computeDeadlinePassed(deadlineAt));
  }

  useEffect(() => {
    if (!deadlineAt || passed) return;
    const msRemaining = Math.max(0, new Date(deadlineAt).getTime() - Date.now());
    const id = setTimeout(() => setPassed(true), msRemaining);
    return () => clearTimeout(id);
  }, [deadlineAt, passed]);

  return passed;
}

export function FantasyBuilder({
  teams,
  activeTeamId,
  league,
  gameweek,
  initialRoster,
  points,
  pointsAvailable,
  leaderboard,
  pointsHistory,
  carriedForwardFromGameweek,
}: FantasyBuilderProps) {
  const [view, setView] = useState<ViewTab>("Squad");
  const [savedRoster, setSavedRoster] = useState(initialRoster);
  const [pending, setPending] = useState(initialRoster);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<PositionGroup | "All">("All");
  const [saveError, setSaveError] = useState<string | null>(null);
  // A save can succeed and still need to tell the manager something — most
  // importantly that the armband moved because their captain was transferred
  // out (see setGameweekRoster).
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, startSaving] = useTransition();
  const [actionPending, startAction] = useTransition();

  const deadlinePassed = useDeadlinePassed(gameweek?.deadlineAt ?? null);
  const locked = gameweek ? deadlinePassed : true;

  const dirty = rosterSignature(pending) !== rosterSignature(savedRoster);
  const validation = useMemo(
    () =>
      validateRoster(
        pending.map((p) => ({
          playerId: p.playerId,
          positionGroup: p.positionGroup,
          price: p.price,
          isStarting: p.isStarting,
          name: p.name,
        })),
      ),
    [pending],
  );

  const validationError = validation.ok ? null : validation.error;

  const totalCost = pending.reduce((sum, p) => sum + p.price, 0);
  const remaining = FANTASY_BUDGET_CAP - totalCost;
  const counts: Record<PositionGroup, number> = { Goalkeepers: 0, Defenders: 0, Midfielders: 0, Forwards: 0 };
  for (const p of pending) if (p.positionGroup !== "Other") counts[p.positionGroup]++;

  const startingXI = pending.filter((p) => p.isStarting);
  const bench = pending.filter((p) => !p.isStarting);
  const selectedPlayer = pending.find((p) => p.playerId === selectedPlayerId) ?? null;
  const selectedIsSaved = selectedPlayer ? savedRoster.some((p) => p.playerId === selectedPlayer.playerId) : false;

  function addPlayer(candidate: FantasyPlayerSearchResult) {
    setPending((prev) => {
      if (prev.some((p) => p.playerId === candidate.id)) return prev;
      if (prev.length >= SQUAD_SIZE) return prev;
      if (candidate.positionGroup === "Other") return prev;
      const groupCount = prev.filter((p) => p.positionGroup === candidate.positionGroup).length;
      if (groupCount >= SQUAD_RULES[candidate.positionGroup]) return prev;
      const newCost = prev.reduce((s, p) => s + p.price, 0) + candidate.price;
      if (newCost > FANTASY_BUDGET_CAP) return prev;

      const startingCount = prev.filter((p) => p.isStarting).length;
      const canStart = startingCount < 11;

      const entry: RosterEntry = {
        playerId: candidate.id,
        name: candidate.name,
        position: candidate.position,
        positionGroup: candidate.positionGroup,
        teamName: candidate.teamName,
        teamCrestUrl: candidate.teamCrestUrl,
        price: candidate.price,
        isStarting: canStart,
        isCaptain: false,
        isViceCaptain: false,
      };
      return [...prev, entry];
    });
  }

  function removePlayer(playerId: string) {
    setPending((prev) => prev.filter((p) => p.playerId !== playerId));
    setSelectedPlayerId(null);
  }

  function toggleStarting(playerId: string) {
    setPending((prev) => prev.map((p) => (p.playerId === playerId ? { ...p, isStarting: !p.isStarting } : p)));
  }

  function handleSave() {
    // `locked` is already `true` whenever `gameweek` is null (see its
    // definition above), so this is redundant today — but checking `gameweek`
    // directly here means TypeScript narrows it for us below instead of this
    // relying on that indirection, and it stays safe even if `locked`'s
    // definition ever changes.
    if (locked || saving || !validation.ok || !gameweek) return;
    setSaveError(null);
    setSaveNotice(null);
    startSaving(async () => {
      const result = await setGameweekRoster(
        activeTeamId,
        gameweek.id,
        pending.map((p) => ({ playerId: p.playerId, isStarting: p.isStarting })),
      );
      if (result.error) {
        setSaveError(result.error);
        return;
      }
      setSaveNotice(result.notice ?? null);
      // Apply the armband the server actually stored, not the flags this list
      // was carrying: setGameweekRoster promotes the vice-captain when the
      // captain is transferred out, and without this the pitch would keep
      // showing no captain while the notice said otherwise.
      const saved = pending.map((p) => ({
        ...p,
        isCaptain: p.playerId === result.captainPlayerId,
        isViceCaptain: p.playerId === result.viceCaptainPlayerId,
      }));
      setPending(saved);
      setSavedRoster(saved);
    });
  }

  function handleCaptainAction(role: "captain" | "vice_captain") {
    if (!selectedPlayer || !gameweek || locked) return;
    setActionError(null);
    const playerId = selectedPlayer.playerId;
    startAction(async () => {
      const result = await setFantasyCaptain(activeTeamId, gameweek.id, playerId, role);
      if (result.error) {
        setActionError(result.error);
        return;
      }
      const apply = (list: RosterEntry[]) =>
        list.map((p) => {
          if (role === "captain") {
            return { ...p, isCaptain: p.playerId === playerId, isViceCaptain: p.isViceCaptain && p.playerId !== playerId };
          }
          return { ...p, isViceCaptain: p.playerId === playerId, isCaptain: p.isCaptain && p.playerId !== playerId };
        });
      setSavedRoster(apply);
      setPending(apply);
      setSelectedPlayerId(null);
    });
  }

  function copyInviteCode() {
    if (!league.inviteCode) return;
    navigator.clipboard?.writeText(league.inviteCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const viewTabRefs = useRef<Partial<Record<ViewTab, HTMLButtonElement | null>>>({});

  function handleViewTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = VIEW_TABS.indexOf(view);
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % VIEW_TABS.length;
    else if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + VIEW_TABS.length) % VIEW_TABS.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = VIEW_TABS.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextTab = VIEW_TABS[nextIndex];
    setView(nextTab);
    viewTabRefs.current[nextTab]?.focus();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 pb-28 lg:px-8">
      <FadeIn className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">{league.name}</h1>
            <p className="text-xs text-foreground-subtle">
              {league.teamCount}/{league.maxTeams} teams · {league.isPrivate ? "Private" : "Public"}
            </p>
          </div>
          {league.inviteCode && (
            <button
              type="button"
              onClick={copyInviteCode}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-xs font-semibold tracking-wide text-foreground-muted transition hover:bg-surface-2 active:scale-95"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-live" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={2} />}
              {league.inviteCode}
              <span className="sr-only" role="status" aria-live="polite">
                {copied ? "Invite code copied" : ""}
              </span>
            </button>
          )}
        </div>

        {teams.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <Link
                key={t.id}
                href={`/fantasy?team=${t.id}`}
                aria-current={t.id === activeTeamId ? "page" : undefined}
                className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-xs font-medium transition ${
                  t.id === activeTeamId ? "kivo-gradient-victory text-on-accent" : "border border-hairline text-foreground-muted hover:bg-surface-2"
                }`}
              >
                {t.name}
              </Link>
            ))}
          </div>
        )}

        <Link
          href="/fantasy/browse"
          className="flex w-fit items-center gap-1 text-xs font-medium text-foreground-subtle transition hover:text-accent"
        >
          <Compass className="h-3.5 w-3.5" strokeWidth={2} />
          Browse public leagues
        </Link>
      </FadeIn>

      <FadeIn
        delay={0.02}
        role="tablist"
        aria-label="Fantasy view"
        onKeyDown={handleViewTabKeyDown}
        className="flex gap-1 border-b border-hairline"
      >
        {VIEW_TABS.map((tab) => (
          <button
            key={tab}
            ref={(el) => {
              viewTabRefs.current[tab] = el;
            }}
            type="button"
            role="tab"
            id={viewTabId(tab)}
            aria-selected={view === tab}
            aria-controls={viewPanelId(tab)}
            tabIndex={view === tab ? 0 : -1}
            onClick={() => setView(tab)}
            className="relative flex-1 px-1 py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <span className={`relative ${view === tab ? "text-foreground" : "text-foreground-muted"}`}>{tab}</span>
            {view === tab && (
              <motion.span
                layoutId="fantasy-view-active-tab"
                className="kivo-gradient-prime absolute inset-x-1 -bottom-px h-0.5 rounded-full"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
          </button>
        ))}
      </FadeIn>

      {view === "Leaderboard" && (
        <FadeIn delay={0.05} role="tabpanel" id={viewPanelId("Leaderboard")} aria-labelledby={viewTabId("Leaderboard")} tabIndex={0}>
          <FantasyLeaderboard
            entries={leaderboard.entries}
            hasAnyScores={leaderboard.hasAnyScores}
            activeTeamId={activeTeamId}
            pointsHistory={pointsHistory}
          />
        </FadeIn>
      )}

      {view === "Squad" && (!gameweek ? (
        <FadeIn
          delay={0.05}
          role="tabpanel"
          id={viewPanelId("Squad")}
          aria-labelledby={viewTabId("Squad")}
          tabIndex={0}
          className="kivo-glass flex flex-col items-center gap-2 rounded-2xl p-8 text-center"
        >
          <Clock className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
          <p className="text-sm text-foreground-muted">No gameweek is open yet for this season.</p>
          <p className="text-xs text-foreground-subtle">Check back once the schedule is set.</p>
        </FadeIn>
      ) : (
        <div role="tabpanel" id={viewPanelId("Squad")} aria-labelledby={viewTabId("Squad")} tabIndex={0} className="flex flex-col gap-5">
          {carriedForwardFromGameweek !== null && (
            <FadeIn
              delay={0.02}
              className="flex w-fit items-center gap-1.5 rounded-full border border-hairline bg-surface-2 px-3 py-1.5 text-[11px] text-foreground-subtle"
            >
              <History className="h-3 w-3 shrink-0" strokeWidth={2} />
              Carried forward from GW{carriedForwardFromGameweek}
            </FadeIn>
          )}
          <FadeIn delay={0.05} className="grid grid-cols-3 gap-3">
            <StatTile
              label={`Gameweek ${gameweek.number}`}
              value={<DeadlineCountdown deadlineAt={gameweek.deadlineAt} />}
              valueClass={locked ? "text-critical" : "text-foreground"}
              caption={<LocalDateTime iso={gameweek.deadlineAt} format="deadline" />}
            />
            <StatTile
              label="Budget left"
              value={formatFantasyPrice(remaining)}
              valueClass={remaining < 0 ? "text-critical" : "text-foreground"}
            />
            <StatTile
              label="Points"
              value={pointsAvailable ? String(points) : "-"}
              valueClass="text-foreground"
              caption={pointsAvailable ? undefined : "Available after this gameweek's matches finish"}
            />
          </FadeIn>

          <FadeIn delay={0.08}>
            <HowScoringWorks />
          </FadeIn>

          <FadeIn delay={0.1} className="flex flex-wrap gap-2">
            {POSITION_GROUPS.map((group) => (
              <span
                key={group}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                  counts[group] === SQUAD_RULES[group] ? "border-live/30 bg-live/10 text-live" : "border-hairline text-foreground-muted"
                }`}
              >
                {group} {counts[group]}/{SQUAD_RULES[group]}
              </span>
            ))}
          </FadeIn>

          {saveNotice && (
            <FadeIn
              delay={0.12}
              className="flex items-center gap-2 rounded-2xl border border-achievement/30 bg-achievement/10 px-3.5 py-2.5 text-xs text-achievement"
              role="status"
            >
              <Crown className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {saveNotice}
            </FadeIn>
          )}

          {pending.length > 0 && !pending.some((p) => p.isCaptain) && (
            <FadeIn
              delay={0.12}
              className="flex items-center gap-2 rounded-2xl border border-achievement/30 bg-achievement/10 px-3.5 py-2.5 text-xs text-achievement"
            >
              <Crown className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              No captain selected — their points won&apos;t be doubled this gameweek.
            </FadeIn>
          )}

          <div className="kivo-glass relative flex flex-col gap-4 overflow-hidden rounded-3xl p-4">
            <PitchLines />
            {pending.length === 0 ? (
              <FadeIn delay={0.15} className="relative flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-foreground-muted">Your squad is empty.</p>
                <p className="max-w-xs text-xs text-foreground-subtle">
                  Pick {SQUAD_SIZE} players: {SQUAD_RULES.Goalkeepers} goalkeepers, {SQUAD_RULES.Defenders} defenders,{" "}
                  {SQUAD_RULES.Midfielders} midfielders and {SQUAD_RULES.Forwards} forwards, within a{" "}
                  {formatFantasyPrice(FANTASY_BUDGET_CAP)} budget.
                </p>
                <p className="max-w-xs text-[11px] text-foreground-subtle">
                  Save your squad first, then open any player to set a captain and vice-captain.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPickerFilter("All");
                    setPickerOpen(true);
                  }}
                  className="kivo-gradient-victory mt-1 flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-on-accent transition active:scale-95"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  Add players
                </button>
              </FadeIn>
            ) : (
              <div className="relative flex flex-col gap-5 py-2">
                {PITCH_ROWS.map((group, rowIndex) => {
                  const groupPlayers = startingXI.filter((p) => p.positionGroup === group);
                  if (groupPlayers.length === 0) return null;
                  return (
                    <FadeIn
                      key={group}
                      delay={0.15 + rowIndex * 0.06}
                      className="flex flex-wrap items-start justify-center gap-3"
                    >
                      {groupPlayers.map((p) => (
                        <PlayerToken key={p.playerId} player={p} onClick={() => setSelectedPlayerId(p.playerId)} />
                      ))}
                    </FadeIn>
                  );
                })}
                {/* A rostered starter whose position doesn't resolve into any of
                    the four known groups (e.g. provider data changed after the
                    pick was saved) must never just vanish off the pitch — it
                    still occupies a paid squad slot. Surfaced in its own
                    flagged row instead of silently being dropped from every
                    PITCH_ROWS group above. */}
                {(() => {
                  const unclassified = startingXI.filter((p) => p.positionGroup === "Other");
                  if (unclassified.length === 0) return null;
                  return (
                    <FadeIn
                      delay={0.15 + PITCH_ROWS.length * 0.06}
                      className="flex flex-col items-center gap-2"
                    >
                      <span className="rounded-full border border-critical/30 bg-critical/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-critical">
                        Unclassified position
                      </span>
                      <div className="flex flex-wrap items-start justify-center gap-3">
                        {unclassified.map((p) => (
                          <PlayerToken key={p.playerId} player={p} onClick={() => setSelectedPlayerId(p.playerId)} />
                        ))}
                      </div>
                    </FadeIn>
                  );
                })()}
              </div>
            )}
          </div>

          {bench.length > 0 && (
            <FadeIn delay={0.4} className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Bench</span>
              <div className="kivo-glass flex gap-3 overflow-x-auto rounded-2xl p-4">
                {bench.map((p) => (
                  <PlayerToken key={p.playerId} player={p} onClick={() => setSelectedPlayerId(p.playerId)} compact />
                ))}
              </div>
            </FadeIn>
          )}

          {pending.length > 0 && pending.length < SQUAD_SIZE && (
            <FadeIn delay={0.45}>
              <button
                type="button"
                onClick={() => {
                  setPickerFilter("All");
                  setPickerOpen(true);
                }}
                disabled={locked}
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-hairline-strong py-3 text-xs font-semibold text-foreground-muted transition hover:bg-surface-2 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Add player ({pending.length}/{SQUAD_SIZE})
              </button>
            </FadeIn>
          )}

          {actionError && (
            <p className="text-xs text-critical" role="status" aria-live="polite">
              {actionError}
            </p>
          )}

          <AnimatePresence>
            {dirty && (
              <motion.div
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="kivo-glass fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-20 mx-auto flex max-w-2xl flex-col gap-2 rounded-2xl p-4 lg:inset-x-auto lg:left-1/2 lg:w-full lg:max-w-2xl lg:-translate-x-1/2"
              >
                {/* KN-56: a failed save gets a retry; a validation error does
                    not, and that distinction is the point. "Try again" on a
                    squad that is two defenders short would fail identically
                    every time — the user has to change something first, so
                    offering a retry there would be a button that lies. */}
                {saveError ? (
                  <RetryableError message={saveError} retrying={saving} onRetry={handleSave} />
                ) : validationError ? (
                  <p className="text-xs text-critical" role="status" aria-live="polite">
                    {validationError}
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-foreground-subtle">
                    {locked ? "The deadline has passed. This gameweek is locked." : "You have unsaved squad changes."}
                  </p>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || locked || !validation.ok}
                    aria-busy={saving}
                    className="kivo-gradient-victory shrink-0 rounded-xl px-4 py-2 text-xs font-semibold text-on-accent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save squad"}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}

      <PlayerActionSheet
        player={selectedPlayer}
        isSaved={selectedIsSaved}
        locked={locked}
        pending={actionPending}
        onClose={() => setSelectedPlayerId(null)}
        onToggleStarting={() => selectedPlayer && toggleStarting(selectedPlayer.playerId)}
        onRemove={() => selectedPlayer && removePlayer(selectedPlayer.playerId)}
        onMakeCaptain={() => handleCaptainAction("captain")}
        onMakeViceCaptain={() => handleCaptainAction("vice_captain")}
      />

      <PlayerPicker
        open={pickerOpen && !!gameweek}
        seasonId={league.seasonId}
        filter={pickerFilter}
        onFilterChange={setPickerFilter}
        onClose={() => setPickerOpen(false)}
        onAdd={addPlayer}
        squadPlayerIds={pending.map((p) => p.playerId)}
        squadCounts={counts}
        remaining={remaining}
        locked={locked}
      />
    </div>
  );
}
