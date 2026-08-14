"use client";

import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Shield } from "lucide-react";
import Image from "next/image";
import { EVENT_LABEL } from "@/lib/football/event-labels";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";

type MatchEvent = {
  id: string;
  eventType: keyof typeof EVENT_LABEL;
  minute: number;
  addedTime: number | null;
  detail: string | null;
  teamId: string;
  playerName: string | null;
  relatedPlayerName: string | null;
};

type LineupEntry = {
  teamId: string;
  isStarting: boolean;
  shirtNumber: number | null;
  position: string | null;
  playerId: string;
  playerName: string;
};

type StandingsRow = {
  teamId: string;
  teamName: string;
  crestUrl: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  position: number | null;
};

type SyncDetailsAction = () => Promise<{ error: string | null; recordsProcessed?: number }>;

type MatchCentreTabsProps = {
  homeTeamId: string;
  awayTeamId: string;
  events: MatchEvent[];
  lineups: LineupEntry[];
  standings: StandingsRow[];
  canSyncDetails: boolean;
  syncDetailsAction: SyncDetailsAction;
};

const TABS = ["Details", "Lineups", "Standings"] as const;
type Tab = (typeof TABS)[number];

function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-sm text-foreground-muted">
      {message}
      {action}
    </div>
  );
}

function DetailsTab({
  events,
  canSyncDetails,
  syncDetailsAction,
}: {
  events: MatchEvent[];
  canSyncDetails: boolean;
  syncDetailsAction: SyncDetailsAction;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        message="No match events synced yet. The timeline appears once this fixture's details have been synced."
        action={canSyncDetails && <InlineSyncButton label="Sync match details" action={syncDetailsAction} />}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {events.map((event) => (
        <div key={event.id} className="kivo-glass flex items-center gap-3 rounded-xl p-3">
          <span className="w-10 shrink-0 text-right text-xs font-semibold text-foreground-subtle">
            {event.minute}
            {event.addedTime ? `+${event.addedTime}` : ""}&apos;
          </span>
          <div className="flex flex-col">
            <span className="text-sm text-foreground">{EVENT_LABEL[event.eventType]}</span>
            <span className="text-xs text-foreground-subtle">
              {event.playerName ?? "Unknown player"}
              {event.relatedPlayerName ? ` · ${event.relatedPlayerName}` : ""}
              {event.detail ? ` · ${event.detail}` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function LineupsTab({
  homeTeamId,
  awayTeamId,
  lineups,
  canSyncDetails,
  syncDetailsAction,
}: {
  homeTeamId: string;
  awayTeamId: string;
  lineups: LineupEntry[];
  canSyncDetails: boolean;
  syncDetailsAction: SyncDetailsAction;
}) {
  if (lineups.length === 0) {
    return (
      <EmptyState
        message="Lineups haven't been synced yet for this fixture."
        action={canSyncDetails && <InlineSyncButton label="Sync match details" action={syncDetailsAction} />}
      />
    );
  }

  const renderTeam = (teamId: string) => {
    const teamLineup = lineups.filter((l) => l.teamId === teamId);
    const starters = teamLineup.filter((l) => l.isStarting);
    const bench = teamLineup.filter((l) => !l.isStarting);
    return (
      <div className="flex flex-col gap-3">
        {starters.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Starting XI</span>
            {starters.map((p) => (
              <div key={p.playerId || p.playerName} className="flex items-center gap-2 text-sm text-foreground">
                <span className="w-6 shrink-0 text-xs text-foreground-subtle">{p.shirtNumber ?? "-"}</span>
                <span className="truncate">{p.playerName}</span>
                {p.position && <span className="text-xs text-foreground-subtle">{p.position}</span>}
              </div>
            ))}
          </div>
        )}
        {bench.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Substitutes</span>
            {bench.map((p) => (
              <div key={p.playerId || p.playerName} className="flex items-center gap-2 text-sm text-foreground-muted">
                <span className="w-6 shrink-0 text-xs text-foreground-subtle">{p.shirtNumber ?? "-"}</span>
                <span className="truncate">{p.playerName}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="kivo-glass rounded-2xl p-4">{renderTeam(homeTeamId)}</div>
      <div className="kivo-glass rounded-2xl p-4">{renderTeam(awayTeamId)}</div>
    </div>
  );
}

function StandingsTab({ standings, homeTeamId, awayTeamId }: { standings: StandingsRow[]; homeTeamId: string; awayTeamId: string }) {
  if (standings.length === 0) {
    return <EmptyState message="Standings haven't been synced yet for this competition." />;
  }
  return (
    <div className="kivo-glass overflow-hidden rounded-2xl">
      <div className="grid grid-cols-[2rem_1fr_2rem_2rem_2rem_2rem] gap-2 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle">
        <span>#</span>
        <span>Team</span>
        <span className="text-right">P</span>
        <span className="text-right">GD</span>
        <span className="text-right">Pts</span>
        <span></span>
      </div>
      {standings.map((row) => {
        const highlighted = row.teamId === homeTeamId || row.teamId === awayTeamId;
        return (
          <div
            key={row.teamId}
            className={`grid grid-cols-[2rem_1fr_2rem_2rem_2rem_2rem] items-center gap-2 px-3 py-2 text-xs ${
              highlighted ? "bg-kivo-cyan/5" : ""
            }`}
          >
            <span className="text-foreground-subtle">{row.position ?? "-"}</span>
            <span className="flex items-center gap-2 truncate text-foreground">
              {row.crestUrl ? (
                <Image src={row.crestUrl} alt={row.teamName} width={16} height={16} className="shrink-0 object-contain" />
              ) : (
                <Shield className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
              )}
              <span className="truncate">{row.teamName}</span>
            </span>
            <span className="text-right text-foreground-muted">{row.played}</span>
            <span className="text-right text-foreground-muted">{row.goalsFor - row.goalsAgainst}</span>
            <span className="text-right font-semibold text-foreground">{row.points}</span>
            <span />
          </div>
        );
      })}
    </div>
  );
}

export function MatchCentreTabs({
  homeTeamId,
  awayTeamId,
  events,
  lineups,
  standings,
  canSyncDetails,
  syncDetailsAction,
}: MatchCentreTabsProps) {
  const [active, setActive] = useState<Tab>("Details");

  return (
    <div className="flex flex-col gap-4">
      <div className="kivo-glass-sharp flex rounded-xl p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActive(tab)}
            className="relative flex-1 rounded-lg py-2 text-xs font-semibold transition"
          >
            {active === tab && (
              <motion.span
                layoutId="match-centre-active-tab"
                className="kivo-gradient-victory absolute inset-0 rounded-lg"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <span className={`relative ${active === tab ? "text-kivo-white" : "text-foreground-muted"}`}>{tab}</span>
          </button>
        ))}
      </div>

      {active === "Details" && (
        <DetailsTab events={events} canSyncDetails={canSyncDetails} syncDetailsAction={syncDetailsAction} />
      )}
      {active === "Lineups" && (
        <LineupsTab
          homeTeamId={homeTeamId}
          awayTeamId={awayTeamId}
          lineups={lineups}
          canSyncDetails={canSyncDetails}
          syncDetailsAction={syncDetailsAction}
        />
      )}
      {active === "Standings" && <StandingsTab standings={standings} homeTeamId={homeTeamId} awayTeamId={awayTeamId} />}
    </div>
  );
}
