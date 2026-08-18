"use client";

import { Suspense, useRef, type KeyboardEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Shield } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { EVENT_LABEL } from "@/lib/football/event-labels";
import { staggerDelay } from "@/lib/stagger";
import { FixtureDetailsSyncControl } from "@/components/matches/fixture-details-sync-control";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { MatchRoomTab, type RoomPost } from "@/components/matches/match-room";
import { LineupPitch, buildPitchRows } from "@/components/matches/lineup-pitch";
import { HeatmapView } from "@/components/matches/heatmap-view";
import { HeatmapEngine } from "@/lib/football/heatmap-engine";
import type { PositionalObservation } from "@/lib/football/positional-types";

type MatchEvent = {
  id: string;
  eventType: keyof typeof EVENT_LABEL;
  minute: number;
  addedTime: number | null;
  detail: string | null;
  teamId: string;
  playerId: string | null;
  playerName: string | null;
  relatedPlayerId: string | null;
  relatedPlayerName: string | null;
};

type LineupEntry = {
  teamId: string;
  isStarting: boolean;
  shirtNumber: number | null;
  position: string | null;
  /** e.g. "4-3-3" — real formation string synced from the provider's
   * /fixtures/lineups response (see migration 0035), null when not yet
   * published for this fixture. Same value repeated across every row for
   * this team_id (denormalized, matching how team_id itself repeats). */
  formation: string | null;
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
  /** Real team names (`fixtures.home_team`/`away_team` join in the page),
   * used only for the Heatmap tab's per-side labels ("<name>'s on-pitch
   * movement") — every other tab already resolves team identity from
   * `standings`/`lineups` rows themselves. */
  homeTeamName: string;
  awayTeamName: string;
  events: MatchEvent[];
  lineups: LineupEntry[];
  stats: TeamStats[];
  standings: StandingsRow[];
  roomPosts: RoomPost[];
  /** RECOMMENDATIONS item 237: a post id to scroll to and briefly highlight
   * once the Room tab renders — see MatchCentrePage, which already
   * guarantees this id is present in `roomPosts` (prepending it if it
   * wasn't on the normally-loaded page) before it ever reaches here. */
  scrollToPostId?: string | null;
  signedIn: boolean;
  canSyncDetails: boolean;
  syncDetailsAction: SyncDetailsAction;
  /** Most recent successful/partial sync_runs timestamp for this fixture's
   * lineups/events/stats (entity_type 'lineup') — see getLastSyncedAt() in
   * src/lib/football/last-synced.ts. RECOMMENDATIONS.md item 60. */
  detailsLastSyncedAt: string | null;
};

const TABS = ["Details", "Stats", "Lineups", "Heatmap", "Standings", "Room"] as const;
type Tab = (typeof TABS)[number];

function tabSlug(tab: Tab): string {
  return tab.toLowerCase();
}

function tabFromSlug(slug: string | null): Tab {
  return TABS.find((tab) => tabSlug(tab) === slug) ?? TABS[0];
}

function PlayerNameLink({ playerId, playerName, className }: { playerId: string; playerName: string; className?: string }) {
  if (!playerId) return <span className={className}>{playerName}</span>;
  return (
    <Link href={`/players/${playerId}`} className={`${className ?? ""} hover:text-kivo-cyan hover:underline`.trim()}>
      {playerName}
    </Link>
  );
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
              {event.playerId ? (
                <Link href={`/players/${event.playerId}`} className="hover:text-kivo-cyan hover:underline">
                  {event.playerName ?? "Unknown player"}
                </Link>
              ) : (
                event.playerName ?? "Unknown player"
              )}
              {event.relatedPlayerName ? (
                <>
                  {" · "}
                  {event.relatedPlayerId ? (
                    <Link href={`/players/${event.relatedPlayerId}`} className="hover:text-kivo-cyan hover:underline">
                      {event.relatedPlayerName}
                    </Link>
                  ) : (
                    event.relatedPlayerName
                  )}
                </>
              ) : null}
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
    // Real formation, positioned pitch view when the data is clean enough to
    // draw one honestly (see buildPitchRows' doc comment) — otherwise the
    // plain list below, never a guessed layout.
    const pitchRows = buildPitchRows(starters);
    const formation = starters[0]?.formation ?? null;

    return (
      <div className="flex flex-col gap-3">
        {pitchRows ? (
          <LineupPitch formation={formation} rows={pitchRows} />
        ) : (
          starters.length > 0 && (
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
                  <PlayerNameLink playerId={p.playerId} playerName={p.playerName} className="truncate" />
                  {p.position && <span className="text-xs text-foreground-subtle">{p.position}</span>}
                </motion.div>
              ))}
            </div>
          )
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
                <PlayerNameLink playerId={p.playerId} playerName={p.playerName} className="truncate" />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="kivo-glass rounded-2xl p-4">{renderTeam(homeTeamId)}</div>
      <div className="kivo-glass rounded-2xl p-4">{renderTeam(awayTeamId)}</div>
    </div>
  );
}

const heatmapEngine = new HeatmapEngine();

/**
 * RECOMMENDATIONS.md item 228: `HeatmapView`/`HeatmapEngine` were already
 * built and tested; this tab is the "add it as a tab" half of that item now
 * that the product decision has been made. No `PositionalDataProvider` is
 * connected anywhere in KIVO (`positional-types.ts`) — both observations
 * arrays below are always empty, so today this always hits the single
 * unified empty state further down. That is the correct, expected
 * behaviour for every real fixture today, not a bug to paper over with
 * sample/fake data.
 *
 * The per-side split only appears once at least one side has real data to
 * show — until then, rendering two near-identical "positional data
 * unavailable" panels side by side (differing only by team name) reads as
 * a doubled-up placeholder rather than one polished "not available yet"
 * message for the whole tab.
 */
function HeatmapTab({
  fixtureId,
  homeTeamName,
  awayTeamName,
}: {
  fixtureId: string;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const homeObservations: PositionalObservation[] = [];
  const awayObservations: PositionalObservation[] = [];
  const anyData =
    heatmapEngine.build(homeObservations, { matchId: fixtureId }).hasData ||
    heatmapEngine.build(awayObservations, { matchId: fixtureId }).hasData;

  if (!anyData) {
    return <HeatmapView observations={[]} matchId={fixtureId} subjectLabel="this match" />;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <HeatmapView observations={homeObservations} matchId={fixtureId} subjectLabel={homeTeamName} />
      <HeatmapView observations={awayObservations} matchId={fixtureId} subjectLabel={awayTeamName} />
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
  // Real `<table>` with `scope="col"` headers (RECOMMENDATIONS.md item 150):
  // this used to be a grid of `<span>`s, which carries no row/column
  // relationships for assistive tech, unlike the admin users table.
  return (
    <div className="kivo-glass overflow-x-auto rounded-2xl">
      <table className="w-full min-w-[26rem] border-collapse text-xs">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
            <th scope="col" className="px-3 py-2 text-left font-semibold">#</th>
            <th scope="col" className="py-2 text-left font-semibold">Team</th>
            <th scope="col" className="py-2 text-right font-semibold">P</th>
            <th scope="col" className="py-2 text-right font-semibold">GD</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((row, index) => {
            const highlighted = row.teamId === homeTeamId || row.teamId === awayTeamId;
            return (
              <motion.tr
                key={row.teamId}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
                className={highlighted ? "bg-kivo-cyan/5" : ""}
              >
                <td className="px-3 py-2 text-foreground-subtle">{row.position ?? "-"}</td>
                <td className="max-w-0 py-2 text-foreground">
                  <span className="flex items-center gap-2 truncate">
                    {row.crestUrl ? (
                      <Image src={row.crestUrl} alt={row.teamName} width={16} height={16} className="shrink-0 object-contain" />
                    ) : (
                      <Shield className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
                    )}
                    <span className="truncate">{row.teamName}</span>
                  </span>
                </td>
                <td className="py-2 text-right text-foreground-muted">{row.played}</td>
                <td className="py-2 text-right text-foreground-muted">{row.goalsFor - row.goalsAgainst}</td>
                <td className="px-3 py-2 text-right font-semibold text-foreground">{row.points}</td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
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
      <div className="flex gap-1 overflow-x-auto border-b border-white/10">
        {TABS.map((tab) => (
          <div
            key={tab}
            className="relative min-w-fit flex-1 whitespace-nowrap px-1 py-2.5 text-center text-xs font-semibold text-foreground-muted"
          >
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
  homeTeamName,
  awayTeamName,
  events,
  lineups,
  stats,
  standings,
  roomPosts,
  scrollToPostId = null,
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
        className="flex gap-1 overflow-x-auto border-b border-white/10"
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
            className="relative min-w-fit flex-1 px-1 py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
          >
            <span className={`relative whitespace-nowrap ${active === tab ? "text-foreground" : "text-foreground-muted"}`}>
              {tab}
            </span>
            {active === tab && (
              <motion.span
                layoutId="match-centre-active-tab"
                className="kivo-gradient-prime absolute inset-x-1 -bottom-px h-0.5 rounded-full"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
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
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
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
          {active === "Heatmap" && <HeatmapTab fixtureId={fixtureId} homeTeamName={homeTeamName} awayTeamName={awayTeamName} />}
          {active === "Standings" && <StandingsTab standings={standings} homeTeamId={homeTeamId} awayTeamId={awayTeamId} />}
          {active === "Room" && (
            <MatchRoomTab fixtureId={fixtureId} signedIn={signedIn} posts={roomPosts} scrollToPostId={scrollToPostId} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
