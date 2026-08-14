"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import {
  UserRound,
  Crown,
  Star,
  Search,
  X,
  Copy,
  Check,
  Clock,
  Plus,
  ArrowUpFromLine,
  ArrowDownToLine,
  Trash2,
  History,
} from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { setGameweekRoster, setFantasyCaptain, searchFantasyPlayers, type FantasyPlayerSearchResult } from "./actions";
import { FantasyLeaderboard, type LeaderboardEntry } from "./fantasy-leaderboard";
import {
  POSITION_GROUPS,
  SQUAD_RULES,
  SQUAD_SIZE,
  FANTASY_BUDGET_CAP,
  formatFantasyPrice,
  formatDeadlineCountdown,
  validateRoster,
  type PositionGroup,
  type PositionGroupOrOther,
} from "./fantasy-rules";

type RosterEntry = {
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

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
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
  carriedForwardFromGameweek,
}: FantasyBuilderProps) {
  const [view, setView] = useState<ViewTab>("Squad");
  const [savedRoster, setSavedRoster] = useState(initialRoster);
  const [pending, setPending] = useState(initialRoster);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<PositionGroup | "All">("All");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, startSaving] = useTransition();
  const [actionPending, startAction] = useTransition();

  const now = useNow(30_000);
  const locked = gameweek ? new Date(gameweek.deadlineAt) <= now : true;

  const dirty = rosterSignature(pending) !== rosterSignature(savedRoster);
  const validation = useMemo(
    () =>
      validateRoster(
        pending.map((p) => ({ playerId: p.playerId, positionGroup: p.positionGroup, price: p.price, isStarting: p.isStarting })),
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
      setSavedRoster(pending);
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
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold tracking-wide text-foreground-muted transition hover:bg-white/5 active:scale-95"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-live" strokeWidth={2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />}
              {league.inviteCode}
            </button>
          )}
        </div>

        {teams.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <Link
                key={t.id}
                href={`/fantasy?team=${t.id}`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  t.id === activeTeamId ? "kivo-gradient-victory text-kivo-white" : "border border-white/10 text-foreground-muted hover:bg-white/5"
                }`}
              >
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </FadeIn>

      <FadeIn
        delay={0.02}
        role="tablist"
        aria-label="Fantasy view"
        onKeyDown={handleViewTabKeyDown}
        className="kivo-glass-sharp flex rounded-xl p-1"
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
            className="relative flex-1 rounded-lg py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
          >
            {view === tab && (
              <motion.span
                layoutId="fantasy-view-active-tab"
                className="kivo-gradient-victory absolute inset-0 rounded-lg"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <span className={`relative ${view === tab ? "text-kivo-white" : "text-foreground-muted"}`}>{tab}</span>
          </button>
        ))}
      </FadeIn>

      {view === "Leaderboard" && (
        <FadeIn delay={0.05} role="tabpanel" id={viewPanelId("Leaderboard")} aria-labelledby={viewTabId("Leaderboard")} tabIndex={0}>
          <FantasyLeaderboard
            entries={leaderboard.entries}
            hasAnyScores={leaderboard.hasAnyScores}
            activeTeamId={activeTeamId}
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
              className="flex w-fit items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-foreground-subtle"
            >
              <History className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              Carried forward from GW{carriedForwardFromGameweek}
            </FadeIn>
          )}
          <FadeIn delay={0.05} className="grid grid-cols-3 gap-3">
            <StatTile label={`Gameweek ${gameweek.number}`} value={formatDeadlineCountdown(gameweek.deadlineAt, now)} valueClass={locked ? "text-critical" : "text-foreground"} />
            <StatTile
              label="Budget left"
              value={formatFantasyPrice(remaining)}
              valueClass={remaining < 0 ? "text-critical" : "text-foreground"}
            />
            <StatTile
              label="Points"
              value={pointsAvailable ? String(points) : "–"}
              valueClass="text-foreground"
              caption={pointsAvailable ? undefined : "Available after this gameweek's matches finish"}
            />
          </FadeIn>

          <FadeIn delay={0.1} className="flex flex-wrap gap-2">
            {POSITION_GROUPS.map((group) => (
              <span
                key={group}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                  counts[group] === SQUAD_RULES[group] ? "border-live/30 bg-live/10 text-live" : "border-white/10 text-foreground-muted"
                }`}
              >
                {group} {counts[group]}/{SQUAD_RULES[group]}
              </span>
            ))}
          </FadeIn>

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
                <button
                  type="button"
                  onClick={() => {
                    setPickerFilter("All");
                    setPickerOpen(true);
                  }}
                  className="kivo-gradient-victory mt-1 flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-kivo-white transition active:scale-95"
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
                className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 py-3 text-xs font-semibold text-foreground-muted transition hover:bg-white/5 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Add player ({pending.length}/{SQUAD_SIZE})
              </button>
            </FadeIn>
          )}

          {actionError && <p className="text-xs text-critical">{actionError}</p>}

          <AnimatePresence>
            {dirty && (
              <motion.div
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
                className="kivo-glass fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-20 mx-auto flex max-w-2xl flex-col gap-2 rounded-2xl p-4 lg:inset-x-auto lg:left-1/2 lg:w-full lg:max-w-2xl lg:-translate-x-1/2"
              >
                {(saveError ?? validationError) && (
                  <p className="text-xs text-critical">{saveError ?? validationError}</p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-foreground-subtle">
                    {locked ? "The deadline has passed. This gameweek is locked." : "You have unsaved squad changes."}
                  </p>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || locked || !validation.ok}
                    className="kivo-gradient-victory shrink-0 rounded-xl px-4 py-2 text-xs font-semibold text-kivo-white transition disabled:opacity-50"
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

function StatTile({ label, value, valueClass, caption }: { label: string; value: string; valueClass: string; caption?: string }) {
  return (
    <div className="kivo-glass flex flex-col gap-1 rounded-2xl p-3">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${valueClass}`}>{value}</span>
      {caption && <span className="text-[10px] leading-snug text-foreground-subtle">{caption}</span>}
    </div>
  );
}

function PitchLines() {
  return (
    <svg
      className="pointer-events-none absolute inset-4 opacity-[0.07]"
      viewBox="0 0 100 140"
      preserveAspectRatio="none"
      aria-hidden
    >
      <rect x="1" y="1" width="98" height="138" fill="none" stroke="currentColor" strokeWidth="1" />
      <line x1="1" y1="70" x2="99" y2="70" stroke="currentColor" strokeWidth="1" />
      <circle cx="50" cy="70" r="16" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="20" y="1" width="60" height="20" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="20" y="119" width="60" height="20" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function PlayerToken({ player, onClick, compact = false }: { player: RosterEntry; onClick: () => void; compact?: boolean }) {
  const size = compact ? 40 : 48;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="group flex flex-col items-center gap-1"
      style={{ width: compact ? 64 : 76 }}
    >
      <div className="relative">
        <div
          className="flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] transition group-hover:bg-white/10"
          style={{ width: size, height: size }}
        >
          <UserRound className="h-1/2 w-1/2 text-foreground-subtle" strokeWidth={1.75} />
        </div>
        {player.teamCrestUrl && (
          <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-kivo-obsidian ring-1 ring-white/10">
            <Image src={player.teamCrestUrl} alt="" width={12} height={12} className="object-contain" />
          </div>
        )}
        <AnimatePresence>
          {player.isCaptain && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="kivo-gradient-victory absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-kivo-white ring-2 ring-kivo-obsidian"
            >
              C
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {player.isViceCaptain && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 22 }}
              className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-achievement/40 bg-achievement/15 text-[10px] font-bold text-achievement ring-2 ring-kivo-obsidian"
            >
              V
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span className="w-full truncate text-center text-[11px] font-medium text-foreground">{player.name}</span>
      <span className="text-[10px] font-semibold tabular-nums text-foreground-subtle">{formatFantasyPrice(player.price)}</span>
    </motion.button>
  );
}

function PlayerActionSheet({
  player,
  isSaved,
  locked,
  pending,
  onClose,
  onToggleStarting,
  onRemove,
  onMakeCaptain,
  onMakeViceCaptain,
}: {
  player: RosterEntry | null;
  isSaved: boolean;
  locked: boolean;
  pending: boolean;
  onClose: () => void;
  onToggleStarting: () => void;
  onRemove: () => void;
  onMakeCaptain: () => void;
  onMakeViceCaptain: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(player !== null, panelRef, onClose);

  return (
    <AnimatePresence>
      {player && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-40 flex flex-col justify-end"
        >
          <button aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${player.name} actions`}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="kivo-glass relative z-10 mx-3 mb-[calc(env(safe-area-inset-bottom)+16px)] flex flex-col gap-3 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <TeamCrest crestUrl={player.teamCrestUrl} name={player.teamName ?? ""} size={28} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{player.name}</p>
                  <p className="truncate text-xs text-foreground-subtle">
                    {[player.position, player.teamName].filter(Boolean).join(" · ") || "—"} · {formatFantasyPrice(player.price)}
                  </p>
                </div>
              </div>
              <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-1.5 text-foreground-subtle transition hover:bg-white/5">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <ActionRow
                icon={player.isStarting ? ArrowDownToLine : ArrowUpFromLine}
                label={player.isStarting ? "Move to bench" : "Move to starting XI"}
                onClick={() => {
                  onToggleStarting();
                  onClose();
                }}
              />
              <ActionRow
                icon={Crown}
                label={player.isCaptain ? "Already captain" : "Make captain"}
                disabled={!isSaved || locked || pending || player.isCaptain}
                hint={!isSaved ? "Save your squad first" : undefined}
                onClick={onMakeCaptain}
              />
              <ActionRow
                icon={Star}
                label={player.isViceCaptain ? "Already vice-captain" : "Make vice-captain"}
                disabled={!isSaved || locked || pending || player.isViceCaptain || player.isCaptain}
                hint={!isSaved ? "Save your squad first" : undefined}
                onClick={onMakeViceCaptain}
              />
              <ActionRow icon={Trash2} label="Remove from squad" tone="critical" onClick={onRemove} />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ActionRow({
  icon: Icon,
  label,
  hint,
  disabled,
  tone = "default",
  onClick,
}: {
  icon: typeof Crown;
  label: string;
  hint?: string;
  disabled?: boolean;
  tone?: "default" | "critical";
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      disabled={disabled}
      onClick={onClick}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-40 ${
        tone === "critical" ? "text-critical hover:bg-critical/10" : "text-foreground hover:bg-white/5"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {label}
      </span>
      {hint && <span className="text-[10px] text-foreground-subtle">{hint}</span>}
    </motion.button>
  );
}

function PlayerPicker({
  open,
  seasonId,
  filter,
  onFilterChange,
  onClose,
  onAdd,
  squadPlayerIds,
  squadCounts,
  remaining,
  locked,
}: {
  open: boolean;
  seasonId: string;
  filter: PositionGroup | "All";
  onFilterChange: (f: PositionGroup | "All") => void;
  onClose: () => void;
  onAdd: (p: FantasyPlayerSearchResult) => void;
  squadPlayerIds: string[];
  squadCounts: Record<PositionGroup, number>;
  remaining: number;
  locked: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FantasyPlayerSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearching] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, panelRef, onClose);

  useEffect(() => {
    if (!open) return;
    const timeout = setTimeout(() => {
      startSearching(async () => {
        const result = await searchFantasyPlayers(seasonId, query, filter);
        setError(result.error);
        setResults(result.players);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [open, query, filter, seasonId]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-40 flex flex-col justify-end"
        >
          <button aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-picker-title"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 36 }}
            className="kivo-glass relative z-10 mx-3 mb-[calc(env(safe-area-inset-bottom)+16px)] flex max-h-[75vh] flex-col gap-3 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="player-picker-title" className="text-sm font-semibold text-foreground">Add a player</h2>
              <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-foreground-subtle transition hover:bg-white/5">
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" strokeWidth={1.75} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players…"
                className="w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-kivo-cyan/50"
              />
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(["All", ...POSITION_GROUPS] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => onFilterChange(group)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    filter === group ? "kivo-gradient-victory text-kivo-white" : "border border-white/10 text-foreground-muted hover:bg-white/5"
                  }`}
                >
                  {group}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {locked ? (
                <p className="py-8 text-center text-xs text-foreground-subtle">This gameweek is locked. Changes are closed.</p>
              ) : error ? (
                <p className="py-8 text-center text-xs text-critical">{error}</p>
              ) : searching && results.length === 0 ? (
                <p className="py-8 text-center text-xs text-foreground-subtle">Searching…</p>
              ) : results.length === 0 ? (
                <p className="py-8 text-center text-xs text-foreground-subtle">
                  No players synced yet. The picker fills in once KIVO&apos;s football data sync has run.
                </p>
              ) : (
                <div className="flex flex-col divide-y divide-white/5">
                  {results.map((p) => {
                    const already = squadPlayerIds.includes(p.id);
                    const group = p.positionGroup;
                    const groupFull = group !== "Other" && squadCounts[group] >= SQUAD_RULES[group];
                    const overBudget = p.price > remaining + 1e-9;
                    const disabled = already || locked || groupFull || overBudget || group === "Other";
                    return (
                      <div key={p.id} className="flex items-center gap-3 py-2.5">
                        <TeamCrest crestUrl={p.teamCrestUrl} name={p.teamName ?? ""} size={26} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">{p.name}</p>
                          <p className="truncate text-[11px] text-foreground-subtle">
                            {[p.position, p.teamName].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{formatFantasyPrice(p.price)}</span>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onAdd(p)}
                          title={already ? "Already in your squad" : groupFull ? `${group} slots are full` : overBudget ? "Over budget" : undefined}
                          className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-foreground-muted transition hover:bg-white/5 disabled:opacity-40"
                        >
                          {already ? (
                            <>
                              <Check className="h-3 w-3" strokeWidth={2} /> Added
                            </>
                          ) : (
                            <>
                              <Plus className="h-3 w-3" strokeWidth={2} /> Add
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
