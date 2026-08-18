"use client";

import { Suspense, useRef, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { EVENT_LABEL } from "@/lib/football/event-labels";
import { TeamCrest } from "@/components/ui/team-crest";
import { staggerDelay } from "@/lib/stagger";
import { FixtureDetailsSyncControl } from "@/components/matches/fixture-details-sync-control";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { MatchRoomTab, type RoomPost } from "@/components/matches/match-room";
import { LineupPitch, buildPitchRows } from "@/components/matches/lineup-pitch";
import { HeatmapView } from "@/components/matches/heatmap-view";
import { HeatmapEngine } from "@/lib/football/heatmap-engine";
import type { PositionalObservation } from "@/lib/football/positional-types";
import type { FixtureStatus } from "@/lib/football/fixture-status";
import { LocalDateTime } from "@/components/ui/relative-time";

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

/** RECOMMENDATIONS.md item 294: the viewer's own current-gameweek fantasy
 * starting XI for this fixture's season (see getViewerFantasyRosterBySeasons
 * in src/lib/football/fantasy-lineup-crossref.ts) — an empty array for a
 * guest, or a signed-in viewer with no fantasy team in this season. */
type ViewerFantasyRosterEntry = { playerId: string; isCaptain: boolean };

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
  viewerFantasyRoster: ViewerFantasyRosterEntry[];
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
  /** KN-53: everything the Overview tab needs to be worth opening on a fixture
   * that has no synced detail yet. All of it is already fetched by
   * matches/[id]/page.tsx for the header it renders above these tabs. */
  preMatch: {
    kickoffAt: string;
    status: FixtureStatus;
    competitionName: string | null;
    venueName: string | null;
    venueCity: string | null;
  };
};

/**
 * KN-53. Details, Stats, Lineups and Heatmap each rendered a near-identical
 * "hasn't been synced yet" panel, so on a scheduled fixture — which is *every*
 * fixture before kickoff — the user paid four taps to learn one fact, and the
 * tab strip promised four things that were all the same nothing.
 *
 * The four data tabs are now only offered when they actually hold data. When
 * none of them do, they collapse into a single "Overview" tab that says it
 * once, and spends the space on what KIVO genuinely knows before a match
 * instead: when it kicks off, where, and which competition it belongs to.
 *
 * This is deliberately the zero-schema interim RECOMMENDATIONS.md item 299's
 * coverage registry will eventually supersede. The distinction it cannot make
 * is "the provider does not support this for this competition" versus "nobody
 * has synced it yet" — so the Overview panel says only the second, which is
 * the one thing that is always true.
 */
const ALL_TABS = ["Overview", "Details", "Stats", "Lineups", "Heatmap", "Standings", "Room"] as const;
type Tab = (typeof ALL_TABS)[number];

/** The tabs that hold provider-synced match detail — the ones that collapse. */
const DATA_TABS = ["Details", "Stats", "Lineups", "Heatmap"] as const;

function tabSlug(tab: Tab): string {
  return tab.toLowerCase();
}

/** Falls back to the *first visible* tab, not to a fixed one: with the data
 * tabs collapsed, `?tab=stats` names a tab that isn't on screen, and landing
 * on a tab the strip doesn't show would leave nothing highlighted. */
function tabFromSlug(slug: string | null, visible: readonly Tab[]): Tab {
  return visible.find((tab) => tabSlug(tab) === slug) ?? visible[0];
}

function PlayerNameLink({ playerId, playerName, className }: { playerId: string; playerName: string; className?: string }) {
  if (!playerId) return <span className={className}>{playerName}</span>;
  return (
    <Link href={`/players/${playerId}`} className={`${className ?? ""} hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`.trim()}>
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

/**
 * KN-53. The one panel that replaces four identical "not synced yet" empty
 * states.
 *
 * Two jobs, in this order. First, be useful: kickoff in the reader's own zone,
 * the venue, the competition — all real columns already fetched for the header
 * above these tabs, and all things a fan actually wants before a match. Second,
 * be honest about the rest in a single sentence, once, instead of four times
 * behind four taps.
 *
 * What it deliberately does not say is *why* the data is missing. KIVO cannot
 * yet distinguish "this provider doesn't cover lineups for this competition"
 * from "nobody has synced this fixture" — that is the coverage registry in
 * RECOMMENDATIONS.md item 299 — so this claims only the part that is always
 * true.
 */
function OverviewTab({ preMatch }: { preMatch: MatchCentreTabsProps["preMatch"] }) {
  const started = preMatch.status !== "scheduled";
  const venue = [preMatch.venueName, preMatch.venueCity].filter(Boolean).join(", ");

  const facts: { label: string; value: ReactNode }[] = [
    { label: "Kick-off", value: <LocalDateTime iso={preMatch.kickoffAt} format="deadline" /> },
    ...(preMatch.competitionName ? [{ label: "Competition", value: preMatch.competitionName }] : []),
    ...(venue ? [{ label: "Venue", value: venue }] : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl px-4">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-baseline justify-between gap-3 py-3">
            <span className="text-xs text-foreground-subtle">{fact.label}</span>
            <span className="text-right text-sm font-medium text-foreground">{fact.value}</span>
          </div>
        ))}
      </div>

      <p className="px-1 text-xs leading-relaxed text-foreground-muted">
        {started
          ? "Timeline, stats and lineups for this match haven't been synced yet. They'll appear here as their own tabs the moment they land."
          : "Timeline, stats and lineups appear here as their own tabs once this fixture has been synced — usually around kick-off."}{" "}
        The Room is open now.
      </p>
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
                <Link href={`/players/${event.playerId}`} className="hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                  {event.playerName ?? "Unknown player"}
                </Link>
              ) : (
                event.playerName ?? "Unknown player"
              )}
              {event.relatedPlayerName ? (
                <>
                  {" · "}
                  {event.relatedPlayerId ? (
                    <Link href={`/players/${event.relatedPlayerId}`} className="hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
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

/** RECOMMENDATIONS.md item 294: a small real "In your XI" pill (+ captain
 * marker) next to a lineup row whose player is starting in the viewer's own
 * current fantasy squad for this fixture's season — the captain badge reuses
 * pitch.tsx's own circular "C" convention (kivo-gradient-victory) rather than
 * inventing a second visual language for the same real fact. */
function InYourXIBadge({ isCaptain }: { isCaptain: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="rounded-full bg-kivo-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-kivo-cyan">
        Your XI
      </span>
      {isCaptain && (
        <span
          title="Your captain"
          aria-label="Your captain"
          className="kivo-gradient-victory flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-kivo-white"
        >
          C
        </span>
      )}
    </span>
  );
}

/**
 * KIVO_NEXT_GEN KN-113: a real side-by-side lineup comparison.
 *
 * Three things were wrong with what this rendered before, all of them the kind
 * that only show up once you look at the two halves as one comparison rather
 * than as two independent lineups:
 *
 *  1. **Neither side was labelled.** Two glass cards, two Starting XIs, no team
 *     name anywhere — on the tab whose entire job is telling you who is playing
 *     for whom. The names were already props on this component (the Heatmap tab
 *     uses them); they were simply never passed down here.
 *  2. **The shapes were never actually compared.** `lineups.formation` is real
 *     synced data (migration 0035) and each side rendered its own badge in
 *     isolation. "4-3-3 vs 4-2-3-1" as one line is the thing a reader is
 *     actually trying to work out, and it costs nothing — the data was already
 *     on screen, just never put next to itself.
 *  3. **The two sides could render in different formats.** `buildPitchRows`
 *     honestly returns null when a side's data won't draw a real pitch, so one
 *     team could appear as a positioned pitch and the other as a flat list. A
 *     side-by-side where the halves aren't like-for-like invites exactly the
 *     wrong read — that one team's shape is known and the other's is unusual,
 *     rather than that KIVO's data for one side is incomplete. So the pitch is
 *     drawn only when **both** sides can draw one, and the honest fallback is
 *     symmetric.
 */
function LineupsTab({
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  lineups,
  viewerFantasyRoster,
}: {
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  lineups: LineupEntry[];
  viewerFantasyRoster: ViewerFantasyRosterEntry[];
}) {
  if (lineups.length === 0) {
    return <EmptyState message="Lineups haven't been synced yet for this fixture." />;
  }

  const rosterByPlayerId = new Map(viewerFantasyRoster.map((r) => [r.playerId, r.isCaptain]));

  const sideData = (teamId: string) => {
    const teamLineup = lineups.filter((l) => l.teamId === teamId);
    const starters = teamLineup.filter((l) => l.isStarting);
    return {
      starters,
      bench: teamLineup.filter((l) => !l.isStarting),
      // Real formation, positioned pitch view when the data is clean enough to
      // draw one honestly (see buildPitchRows' doc comment) — otherwise the
      // plain list, never a guessed layout.
      pitchRows: buildPitchRows(starters),
      formation: starters[0]?.formation ?? null,
    };
  };

  const home = sideData(homeTeamId);
  const away = sideData(awayTeamId);
  // Like-for-like or not at all — see point 3 in this component's doc comment.
  const drawPitches = home.pitchRows !== null && away.pitchRows !== null;

  const renderTeam = (teamName: string, side: ReturnType<typeof sideData>) => {
    const { starters, bench, pitchRows, formation } = side;

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{teamName}</span>
          {formation && (
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              {formation}
            </span>
          )}
        </div>
        {drawPitches && pitchRows ? (
          <LineupPitch formation={formation} rows={pitchRows} viewerFantasyRoster={rosterByPlayerId} />
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
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <PlayerNameLink playerId={p.playerId} playerName={p.playerName} className="truncate" />
                    {rosterByPlayerId.has(p.playerId) && <InYourXIBadge isCaptain={rosterByPlayerId.get(p.playerId)!} />}
                  </div>
                  {p.position && <span className="shrink-0 text-xs text-foreground-subtle">{p.position}</span>}
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
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <PlayerNameLink playerId={p.playerId} playerName={p.playerName} className="truncate" />
                  {rosterByPlayerId.has(p.playerId) && <InYourXIBadge isCaptain={rosterByPlayerId.get(p.playerId)!} />}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const bothFormations = home.formation && away.formation;

  return (
    <div className="flex flex-col gap-3">
      {/* The shape comparison itself. Only rendered when both sides have a real
          synced formation — one formation next to a blank is not a comparison,
          and a dash in place of the missing one would read as a claim about
          the team rather than about KIVO's data. When only one side has it,
          that side's own badge (inside its card below) still shows it. */}
      {bothFormations && (
        <div className="kivo-glass-sharp flex items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm">
          <span className="font-semibold text-foreground">{home.formation}</span>
          <span className="text-[11px] uppercase tracking-wide text-foreground-subtle">shape</span>
          <span className="font-semibold text-foreground">{away.formation}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="kivo-glass rounded-2xl p-4">{renderTeam(homeTeamName, home)}</div>
        <div className="kivo-glass rounded-2xl p-4">{renderTeam(awayTeamName, away)}</div>
      </div>
      {/* Said once, for the whole tab, rather than left for the reader to infer
          from two lists where they expected two pitches. */}
      {!drawPitches && (home.starters.length > 0 || away.starters.length > 0) && (
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          Both sides are shown as lists: a positioned pitch is only drawn when every starter on{" "}
          <em>both</em> teams has a real synced position, and one of these lineups doesn&apos;t yet. Showing one pitch
          and one list would suggest KIVO knows more about one team&apos;s shape than the other.
        </p>
      )}
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
        // KIVO_NEXT_GEN KN-7: a missing statistic used to be coerced to 0
        // (`homeVal ?? 0`) purely so the comparison bar had a number to divide
        // by. The numeric label correctly rendered "-", so the row said "not
        // reported" in text and drew a confident 100%/0% split right underneath
        // it. That is routine, not exotic: `fixture_statistics.expected_goals`
        // is nullable by design because API-Football's free tier often reports
        // xG for one side and not the other. A fabricated visual claim in the
        // most screenshot-prone section of the app is the same class of error
        // as a fabricated number — the bar simply has nothing to compare, so it
        // renders as one flat neutral rail rather than a split.
        const total = homeVal !== null && awayVal !== null ? homeVal + awayVal : null;
        const homePct = total !== null && total > 0 ? ((homeVal ?? 0) / total) * 100 : 50;
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
            {total !== null ? (
              <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-inset">
                <div className="kivo-gradient-prime h-full" style={{ width: `${homePct}%` }} />
                <div className="h-full bg-surface-track" style={{ width: `${100 - homePct}%` }} />
              </div>
            ) : (
              <div
                className="h-1.5 rounded-full bg-surface-inset"
                title={`${row.label} was only reported for one side, so there is nothing to compare.`}
              />
            )}
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
    // kivo-scroll-fade-x (RECOMMENDATIONS.md item 277): signals there's more
    // to scroll to on a narrow viewport, reusing .kivo-ticker's own
    // edge-mask technique (globals.css) rather than a new one.
    <div className="kivo-glass kivo-scroll-fade-x overflow-x-auto rounded-2xl">
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
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
                className={highlighted ? "bg-accent/5" : ""}
              >
                <td className="px-3 py-2 text-foreground-subtle">{row.position ?? "-"}</td>
                <td className="max-w-0 py-2 text-foreground">
                  <span className="flex items-center gap-2 truncate">
                    {/* TeamCrest, not a bare <Image> (KIVO_NEXT_GEN KN-2): this
                        was the one crest render in the app still going through
                        next/image's optimizer, which throws in dev and answers
                        400 in production for any host not in
                        `images.remotePatterns` — so switching
                        FOOTBALL_DATA_PROVIDER to a provider serving crests from
                        a different CDN broke this table specifically. Every
                        other crest call site already renders `unoptimized`
                        through this component. */}
                    <TeamCrest crestUrl={row.crestUrl} name={row.teamName} size={16} />
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
      <div className="flex gap-1 overflow-x-auto border-b border-hairline">
        {ALL_TABS.filter((tab) => tab !== "Overview").map((tab) => (
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
  viewerFantasyRoster,
  stats,
  standings,
  roomPosts,
  scrollToPostId = null,
  signedIn,
  canSyncDetails,
  syncDetailsAction,
  detailsLastSyncedAt,
  preMatch,
}: MatchCentreTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // KN-53: a data tab earns its place by holding data. The Heatmap has no
  // positional source wired up at all yet (see HeatmapTab), so today it is
  // always in the collapsed group — which is more honest than a permanently
  // empty tab that implies the feature is a sync away.
  const dataTabAvailability: Record<(typeof DATA_TABS)[number], boolean> = {
    Details: events.length > 0,
    Stats: stats.length > 0,
    Lineups: lineups.length > 0,
    Heatmap: false,
  };
  const availableDataTabs = DATA_TABS.filter((tab) => dataTabAvailability[tab]);
  const collapsed = availableDataTabs.length === 0;

  const visibleTabs: Tab[] = [
    ...(collapsed ? (["Overview"] as const) : availableDataTabs),
    "Standings",
    "Room",
  ];

  const active = tabFromSlug(searchParams.get("tab"), visibleTabs);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // Shallow URL update (no server round-trip re-fetching this page's match
  // data): plain window.history so back/forward and bookmarking work, per
  // node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md
  // ("Shallow routing on the client").
  function setActive(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === visibleTabs[0]) {
      params.delete("tab");
    } else {
      params.set("tab", tabSlug(tab));
    }
    const qs = params.toString();
    window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
  }

  function handleTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const currentIndex = visibleTabs.indexOf(active);
    let nextIndex: number | null = null;
    if (e.key === "ArrowRight") nextIndex = (currentIndex + 1) % visibleTabs.length;
    else if (e.key === "ArrowLeft") nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
    else if (e.key === "Home") nextIndex = 0;
    else if (e.key === "End") nextIndex = visibleTabs.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextTab = visibleTabs[nextIndex];
    setActive(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Match centre sections"
        onKeyDown={handleTabKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-hairline"
      >
        {visibleTabs.map((tab) => (
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
            className="relative min-w-fit flex-1 px-1 py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
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
      {(active === "Overview" || active === "Details" || active === "Stats" || active === "Lineups") && (
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
          {active === "Overview" && <OverviewTab preMatch={preMatch} />}
          {active === "Details" && <DetailsTab events={events} />}
          {active === "Stats" && <StatsTab stats={stats} homeTeamId={homeTeamId} awayTeamId={awayTeamId} />}
          {active === "Lineups" && (
            <LineupsTab
              homeTeamId={homeTeamId}
              awayTeamId={awayTeamId}
              homeTeamName={homeTeamName}
              awayTeamName={awayTeamName}
              lineups={lineups}
              viewerFantasyRoster={viewerFantasyRoster}
            />
          )}
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
