"use client";

import { Suspense, useRef, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Shield } from "lucide-react";
import Image from "next/image";
import { EVENT_LABEL } from "@/lib/football/event-labels";
import { InlineSyncButton } from "@/components/admin/inline-sync-button";
import { MatchRoomTab, type RoomPost } from "@/components/matches/match-room";

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
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  events: MatchEvent[];
  lineups: LineupEntry[];
  standings: StandingsRow[];
  roomPosts: RoomPost[];
  signedIn: boolean;
  canSyncDetails: boolean;
  syncDetailsAction: SyncDetailsAction;
};

const TABS = ["Details", "Lineups", "Standings", "Room"] as const;
type Tab = (typeof TABS)[number];

function tabSlug(tab: Tab): string {
  return tab.toLowerCase();
}

function tabFromSlug(slug: string | null): Tab {
  return TABS.find((tab) => tabSlug(tab) === slug) ?? TABS[0];
}

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
      {events.map((event, index) => (
        <motion.div
          key={event.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3), ease: [0.22, 1, 0.36, 1] }}
          className="kivo-glass flex items-center gap-3 rounded-xl p-3"
        >
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
        </motion.div>
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
            {starters.map((p, index) => (
              <motion.div
                key={p.playerId || p.playerName}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3), ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <span className="w-6 shrink-0 text-xs text-foreground-subtle">{p.shirtNumber ?? "-"}</span>
                <span className="truncate">{p.playerName}</span>
                {p.position && <span className="text-xs text-foreground-subtle">{p.position}</span>}
              </motion.div>
            ))}
          </div>
        )}
        {bench.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Substitutes</span>
            {bench.map((p, index) => (
              <motion.div
                key={p.playerId || p.playerName}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(0.1 + index * 0.03, 0.4), ease: [0.22, 1, 0.36, 1] }}
                className="flex items-center gap-2 text-sm text-foreground-muted"
              >
                <span className="w-6 shrink-0 text-xs text-foreground-subtle">{p.shirtNumber ?? "-"}</span>
                <span className="truncate">{p.playerName}</span>
              </motion.div>
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
      {standings.map((row, index) => {
        const highlighted = row.teamId === homeTeamId || row.teamId === awayTeamId;
        return (
          <motion.div
            key={row.teamId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3), ease: [0.22, 1, 0.36, 1] }}
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
          </motion.div>
        );
      })}
    </div>
  );
}

export function MatchCentreTabs(props: MatchCentreTabsProps) {
  // useSearchParams() needs a Suspense boundary so the rest of the page can
  // still be server-prerendered around this — see
  // node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md.
  return (
    <Suspense fallback={<MatchCentreTabsFallback />}>
      <MatchCentreTabsInner {...props} />
    </Suspense>
  );
}

function MatchCentreTabsFallback() {
  return (
    <div className="flex flex-col gap-4">
      <div className="kivo-glass-sharp flex rounded-xl p-1">
        {TABS.map((tab) => (
          <div key={tab} className="relative flex-1 rounded-lg py-2 text-center text-xs font-semibold text-foreground-muted">
            {tab}
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchCentreTabsInner({
  fixtureId,
  homeTeamId,
  awayTeamId,
  events,
  lineups,
  standings,
  roomPosts,
  signedIn,
  canSyncDetails,
  syncDetailsAction,
}: MatchCentreTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = tabFromSlug(searchParams.get("tab"));
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // Shallow URL update (no server round-trip re-fetching this page's match
  // data): plain window.history so back/forward and bookmarking work, per
  // node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md
  // ("Shallow routing on the client").
  function setActive(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === TABS[0]) {
      params.delete("tab");
    } else {
      params.set("tab", tabSlug(tab));
    }
    const qs = params.toString();
    window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = TABS.indexOf(active);
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % TABS.length;
    else if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextTab = TABS[nextIndex];
    setActive(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Match centre sections"
        onKeyDown={handleTabKeyDown}
        className="kivo-glass-sharp flex rounded-xl p-1"
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            ref={(el) => {
              tabRefs.current[tab] = el;
            }}
            type="button"
            role="tab"
            id={`match-centre-tab-${tabSlug(tab)}`}
            aria-selected={active === tab}
            aria-controls={`match-centre-panel-${tabSlug(tab)}`}
            tabIndex={active === tab ? 0 : -1}
            onClick={() => setActive(tab)}
            className="relative flex-1 rounded-lg py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
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

      <AnimatePresence mode="wait">
        <motion.div
          key={active}
          role="tabpanel"
          id={`match-centre-panel-${tabSlug(active)}`}
          aria-labelledby={`match-centre-tab-${tabSlug(active)}`}
          tabIndex={0}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
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
          {active === "Room" && <MatchRoomTab fixtureId={fixtureId} signedIn={signedIn} posts={roomPosts} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
