"use client";

import { Suspense, useRef, type KeyboardEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Shield } from "lucide-react";
import Image from "next/image";
import { EVENT_LABEL } from "@/lib/football/event-labels";
import { staggerDelay } from "@/lib/stagger";
import { FixtureDetailsSyncControl } from "@/components/matches/fixture-details-sync-control";
import { LastSyncedNote } from "@/components/football/last-synced-note";
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

type TeamStats = {
  teamId: string;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  shotsOffTarget: number | null;
  shotsBlocked: number | null;
  shotsInsideBox: number | null;
  shotsOutsideBox: number | null;
  fouls: number | null;
  corners: number | null;
  offsides: number | null;
  possessionPct: number | null;
  yellowCards: number | null;
  redCards: number | null;
  saves: number | null;
  passesTotal: number | null;
  passesAccurate: number | null;
  passesPct: number | null;
  expectedGoals: number | null;
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

/** `autoSyncMissingSquads` (RECOMMENDATIONS.md item 59) is read at click time from
 * FixtureDetailsSyncControl's own checkbox state, not stored here. */
type SyncDetailsAction = (autoSyncMissingSquads: boolean) => Promise<{ error: string | null; recordsProcessed?: number }>;

type MatchCentreTabsProps = {
  fixtureId: string;
  homeTeamId: string;
  awayTeamId: string;
  events: MatchEvent[];
  lineups: LineupEntry[];
  stats: TeamStats[];
  standings: StandingsRow[];
  roomPosts: RoomPost[];
  signedIn: boolean;
  canSyncDetails: boolean;
  syncDetailsAction: SyncDetailsAction;
  /** Most recent successful/partial sync_runs timestamp for this fixture's
   * lineups/events/stats (entity_type 'lineup') — see getLastSyncedAt() in
   * src/lib/football/last-synced.ts. RECOMMENDATIONS.md item 60. */
  detailsLastSyncedAt: string | null;
};

const TABS = ["Details", "Stats", "Lineups", "Standings", "Room"] as const;
type Tab = (typeof TABS)[number];

function tabSlug(tab: Tab): string {
  return tab.toLowerCase();
}

function tabFromSlug(slug: string | null): Tab {
  return TABS.find((tab) => tabSlug(tab) === slug) ?? TABS[0];
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center text-sm text-foreground-muted">
      {message}
    </div>
  );
}

function DetailsTab({ events }: { events: MatchEvent[] }) {
  if (events.length === 0) {
    return <EmptyState message="No match events synced yet. The timeline appears once this fixture's details have been synced." />;
  }
  return (
    <div className="flex flex-col gap-2">
      {events.map((event, index) => (
        <motion.div
          key={event.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
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
}: {
  homeTeamId: string;
  awayTeamId: string;
  lineups: LineupEntry[];
}) {
  if (lineups.length === 0) {
    return <EmptyState message="Lineups haven't been synced yet for this fixture." />;
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
                transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
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
                transition={{ duration: 0.2, delay: 0.1 + staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
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

const STAT_ROWS: { key: keyof Omit<TeamStats, "teamId">; label: string; suffix?: string }[] = [
  { key: "possessionPct", label: "Possession", suffix: "%" },
  { key: "shotsTotal", label: "Shots" },
  { key: "shotsOnTarget", label: "Shots on target" },
  { key: "corners", label: "Corners" },
  { key: "fouls", label: "Fouls" },
  { key: "offsides", label: "Offsides" },
  { key: "yellowCards", label: "Yellow cards" },
  { key: "redCards", label: "Red cards" },
  { key: "passesPct", label: "Pass accuracy", suffix: "%" },
  { key: "saves", label: "Saves" },
  { key: "expectedGoals", label: "xG" },
];

function StatsTab({
  stats,
  homeTeamId,
  awayTeamId,
}: {
  stats: TeamStats[];
  homeTeamId: string;
  awayTeamId: string;
}) {
  const home = stats.find((s) => s.teamId === homeTeamId);
  const away = stats.find((s) => s.teamId === awayTeamId);

  if (!home && !away) {
    return <EmptyState message="Stats haven't been synced yet for this fixture." />;
  }

  const rows = STAT_ROWS.filter((row) => home?.[row.key] != null || away?.[row.key] != null);

  return (
    <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-4">
      {rows.map((row) => {
        const homeVal = home?.[row.key] ?? null;
        const awayVal = away?.[row.key] ?? null;
        const homeNum = homeVal ?? 0;
        const awayNum = awayVal ?? 0;
        const total = homeNum + awayNum;
        const homePct = total > 0 ? (homeNum / total) * 100 : 50;
        return (
          <div key={row.key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="w-12 text-left font-semibold text-foreground">
                {homeVal ?? "-"}
                {homeVal !== null ? row.suffix ?? "" : ""}
              </span>
              <span className="text-foreground-subtle">{row.label}</span>
              <span className="w-12 text-right font-semibold text-foreground">
                {awayVal ?? "-"}
                {awayVal !== null ? row.suffix ?? "" : ""}
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
              <div className="kivo-gradient-prime h-full" style={{ width: `${homePct}%` }} />
              <div className="h-full bg-white/15" style={{ width: `${100 - homePct}%` }} />
            </div>
          </div>
        );
      })}
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
            transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
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
  stats,
  standings,
  roomPosts,
  signedIn,
  canSyncDetails,
  syncDetailsAction,
  detailsLastSyncedAt,
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

      {/* Persistent freshness + sync control for the three tabs backed by
          syncFixtureDetails (RECOMMENDATIONS.md item 60) — lives above the tab
          panel itself (not buried in each tab's empty state) so an admin can
          re-sync a fixture that already has partial data (e.g. mid-match, to
          pull fresher stats), not just an entirely-unsynced one. Standings and
          Room aren't backed by this action, so the bar only shows for the
          other three. */}
      {(active === "Details" || active === "Stats" || active === "Lineups") && (
        <div className="flex items-center justify-between gap-3 px-1">
          <LastSyncedNote timestamp={detailsLastSyncedAt} label="Match details synced" />
          {canSyncDetails && <FixtureDetailsSyncControl action={syncDetailsAction} />}
        </div>
      )}

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
          {active === "Details" && <DetailsTab events={events} />}
          {active === "Stats" && <StatsTab stats={stats} homeTeamId={homeTeamId} awayTeamId={awayTeamId} />}
          {active === "Lineups" && <LineupsTab homeTeamId={homeTeamId} awayTeamId={awayTeamId} lineups={lineups} />}
          {active === "Standings" && <StandingsTab standings={standings} homeTeamId={homeTeamId} awayTeamId={awayTeamId} />}
          {active === "Room" && <MatchRoomTab fixtureId={fixtureId} signedIn={signedIn} posts={roomPosts} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
