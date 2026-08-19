"use client";

import { Suspense, useRef, type KeyboardEvent, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import Link from "next/link";
import {
  ArrowLeftRight,
  ChevronDown,
  CircleSlash,
  RectangleVertical,
  ScanEye,
  Volleyball,
  type LucideIcon,
} from "lucide-react";
import { EVENT_LABEL, isGoalEventType } from "@/lib/football/event-labels";
import { TeamCrest } from "@/components/ui/team-crest";
import { staggerDelay } from "@/lib/stagger";
import { FixtureDetailsSyncControl } from "@/components/matches/fixture-details-sync-control";
import { LastSyncedNote } from "@/components/football/last-synced-note";
import { MatchRoomTab, type RoomPost } from "@/components/matches/match-room";
import { MatchOverview, type MatchOverviewFacts } from "@/components/matches/match-overview";
import { TeamSheetView, type ManagerRef } from "@/components/matches/team-sheet-view";
import { PlayerRatingsView } from "@/components/matches/player-ratings-view";
import { buildTeamSheet } from "@/lib/football/team-sheet";
import {
  pickStandoutPlayer,
  rankRatedPlayers,
  rateTeamSheet,
  ratingsByPlayerId,
} from "@/lib/football/fixture-ratings";
import type { FormSummary } from "@/lib/football/form-engine";
import { HeatmapView } from "@/components/matches/heatmap-view";
import { buildFixtureHeatmaps, hasFixtureHeatmapContent } from "@/lib/football/heatmap/fixture-heatmap";
import { HeadToHeadCard } from "@/components/football/head-to-head-card";
import type { HeadToHeadRecord } from "@/lib/football/head-to-head";
import { isLiveStatus } from "@/lib/football/fixture-status";
import type { MatchRoomWindow } from "@/lib/match-room-window";
import { useRealtimeFixtureEvents } from "@/hooks/use-realtime-fixture-events";
import { resolveEventSide, resolveTabFromSlug, type EventSide } from "@/lib/football/match-timeline";

export type MatchEvent = {
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
  /** The provider's own formation slot for this player, "row:col", row 1 being
   * the goalkeeper's line and counting upfield (migration 0081, synced from
   * /fixtures/lineups at no extra request cost — the response already carries
   * it). Null for every substitute and whenever the provider omits it.
   *
   * Passed through rather than used directly here: it is the only genuinely
   * positional field the provider publishes, and `buildFixtureHeatmaps` knows
   * how to read it. Deliberately NOT used to decide left from right anywhere —
   * whether column 1 is a team's left or its right is unverified, and a pitch
   * that draws a right-back on the left looks completely authoritative while
   * being half the time wrong. */
  grid: string | null;
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
  /** Real team names (`fixtures.home_team`/`away_team` join in the page).
   * Needed by every tab that has to say which club a number or an event
   * belongs to and cannot get it from its own rows: the Timeline's two sides,
   * the Stats rows' screen-reader alternatives, the Heatmap's per-side labels.
   * Standings and Lineups still resolve team identity from their own rows. */
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
  /** KN-62: the viewer's own profile id and display name, for Match Room
   * presence. Null when it could not be resolved — presence then simply never
   * tracks, rather than putting an unnamed body in the "watching" count. */
  viewer: { id: string; name: string } | null;
  canSyncDetails: boolean;
  syncDetailsAction: SyncDetailsAction;
  /** Most recent successful/partial sync_runs timestamp for this fixture's
   * lineups/events/stats (entity_type 'lineup') — see getLastSyncedAt() in
   * src/lib/football/last-synced.ts. RECOMMENDATIONS.md item 60. */
  detailsLastSyncedAt: string | null;
  /** When this fixture's Match Room accepts new posts, as the server decided
   * at render time. Computed by matches/[id]/page.tsx from the same kickoff
   * and status in `preMatch`; see src/lib/match-room-window.ts. */
  roomWindow: MatchRoomWindow;
  /** Everything the Overview tab needs — kick-off, competition, round, venue,
   * referee. All of it is already fetched by matches/[id]/page.tsx for the
   * header it renders above these tabs, and the Overview tab is now always
   * present rather than a fallback, so this is always read. */
  preMatch: MatchOverviewFacts;
  /** The fixture's real final (or running) score, for the rating engine's
   * clean-sheet and goals-conceded terms. Null before either has been
   * reported, which is exactly when the engine declines to rate anybody. */
  homeScore: number | null;
  awayScore: number | null;
  /** Each club's own real recent form, computed by form-engine.ts from
   * finished fixtures KIVO already holds (see matches/[id]/page.tsx). Null
   * for a club with no finished match on record — the Overview then says so
   * rather than drawing an empty strip. */
  homeForm: FormSummary | null;
  awayForm: FormSummary | null;
  /** The manager who picked each of these team sheets. Already joined on the
   * page for its header; passed down so the Lineups tab can name them, which
   * is where a fan looks for them. */
  homeManager: ManagerRef;
  awayManager: ManagerRef;
  /** Real head-to-head record between these two clubs, computed by
   * getHeadToHead() from finished fixtures only. Null when either side of
   * the fixture has no resolved team row — the tab is then not offered at
   * all rather than rendering a card about two unnamed teams.
   *
   * This used to render as a standalone card in the page body *below* these
   * tabs, which meant a fan had to scroll past the entire tab panel to reach
   * it. The Master Directive lists H2H as a Match Centre section alongside
   * Stats, Lineups and Standings, and that is where it belongs. */
  headToHead: {
    teamA: { name: string; shortName: string | null };
    teamB: { name: string; shortName: string | null };
    record: HeadToHeadRecord;
  } | null;
  /** The provider's OWN statement about what it publishes for this fixture's
   * competition (`provider_coverage`, migration 0082), or null when the
   * registry has never been synced for it.
   *
   * This closes the limitation the KN-53 comment below states about itself: an
   * empty Timeline, Stats or Lineups tab has two causes that look identical
   * from here — the provider does not publish that for this competition, or
   * nobody has synced this fixture yet — and until now the Overview panel
   * could only claim the second, because it was the only one always true.
   * `false` means the provider says it does not publish it; `null` means KIVO
   * has not established either way, and says nothing rather than guessing. */
  competitionCoverage: {
    events: boolean | null;
    lineups: boolean | null;
    statistics: boolean | null;
  } | null;
};

/**
 * The Match Centre's shape.
 *
 * ## What KN-53 got right, and what it got wrong
 *
 * KN-53 made the four provider-backed tabs conditional on actually holding
 * data, which was right: a tab strip that promises Timeline, Stats, Lineups
 * and Heatmap and delivers the same apology behind all four charges a fan
 * four taps for one fact. That rule stays.
 *
 * What it got wrong was making **Overview** the consolation prize. Overview
 * only existed while every data tab was empty, and vanished the moment one
 * filled — so the Match Centre had a summary exactly when there was nothing
 * to summarise, and none at all once there was. On a finished match a fan
 * landed straight in a raw event list with no scoreline context, no form, no
 * table, no head-to-head. That is the "no standing, no head to head" the
 * founder was looking at.
 *
 * Overview is now **always the first tab**, and it is a real front page: match
 * flow, both clubs' form, the head-to-head record, where the two sit in the
 * table, and the fixture's own facts — see match-overview.tsx. The deep tabs
 * sit behind it, each appearing when it holds something, which is the
 * progressive hierarchy this product is supposed to have: the important thing
 * immediately, the advanced thing one tap away, and nothing promised that
 * isn't there.
 *
 * ## The two tabs that used to be unreachable
 *
 * **H2H** was offered only when the two clubs had already met in a finished
 * fixture KIVO holds — with almost no history in the database that condition
 * was never true, so a tab the founder explicitly asked for had never once
 * appeared. It is now offered whenever both clubs resolve, and the card
 * already had an honest "first meeting on record" state written for it.
 *
 * **Standings** always rendered and was always empty. It now says what a table
 * is waiting on instead of blaming a sync.
 */
const ALL_TABS = ["Overview", "Timeline", "Lineups", "Ratings", "Stats", "Heatmap", "H2H", "Standings", "Room"] as const;
type Tab = (typeof ALL_TABS)[number];

/** The three tabs offered on every fixture whatever it holds: the front page,
 * the table and the Room. Derived from ALL_TABS so the strip's order is stated
 * in exactly one place. */
const ALWAYS_TABS: Tab[] = ALL_TABS.filter((tab) => tab === "Overview" || tab === "Standings" || tab === "Room");

/** The tabs backed by this fixture's own provider-fetched detail — the ones
 * that appear only once they hold something. Ordered as a fan reads a match:
 * what happened, who played, how they rated, the numbers, the shape. */
const DATA_TABS = ["Timeline", "Lineups", "Ratings", "Stats", "Heatmap"] as const;

/** How each deep tab is named in the Overview panel's one honest sentence
 * about what KIVO does not hold yet. Lower case and in KIVO's own words,
 * because it is read inside a sentence rather than as a label. */
const MISSING_AREA_LABEL: Record<(typeof DATA_TABS)[number], string> = {
  Timeline: "the timeline",
  Lineups: "line-ups",
  Ratings: "player ratings",
  Stats: "stats",
  Heatmap: "touch maps",
};

function tabSlug(tab: Tab): string {
  return tab.toLowerCase();
}

/** Slugs that used to name a tab and still appear in links people have
 * already shared or bookmarked. "Details" was renamed to "Timeline" (it
 * always rendered fixture events chronologically — the name just didn't say
 * so), and an existing `?tab=details` link should land on that same panel
 * rather than silently falling back to whatever tab happens to be first. */
const LEGACY_TAB_SLUGS: Record<string, Tab> = { details: "Timeline" };

function tabFromSlug(slug: string | null, visible: readonly Tab[]): Tab {
  return resolveTabFromSlug(slug, visible, tabSlug, LEGACY_TAB_SLUGS);
}

function PlayerNameLink({ playerId, playerName, className }: { playerId: string; playerName: string; className?: string }) {
  if (!playerId) return <span className={className}>{playerName}</span>;
  return (
    <Link href={`/players/${playerId}`} className={`${className ?? ""} hover:text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60`.trim()}>
      {playerName}
    </Link>
  );
}

/**
 * The one shape every "KIVO does not hold this" panel takes.
 *
 * The word "synced" is gone from all of them, deliberately. It is KIVO's
 * internal word for its own pipeline, and a fan reading "lineups have not been
 * synced" learns nothing they can act on — it sounds like a fault. What they
 * can act on is *when the thing normally exists*: team sheets land about an
 * hour before kick-off, statistics arrive with the match, a goalless first
 * half genuinely has nothing in it. Each caller says its own version of that.
 */
function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="kivo-glass flex flex-col items-center gap-2 rounded-2xl p-6 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-foreground-muted">{message}</p>
      {action}
    </div>
  );
}


/**
 * The Master Directive's "live event timeline" for a fixture. This is the tab
 * that was called "Details" — it has always rendered `fixture_events` in
 * minute order, the label just never said so, which is why the Match Centre
 * read as if it had no timeline at all.
 *
 * What it is not: full text commentary. The provider's /fixtures/events
 * returns discrete scoring and disciplinary events only (goals, penalties,
 * cards, substitutions, VAR reviews) with no ball-by-ball narration on any
 * tier, so the footnote below says exactly that rather than leaving a fan to
 * conclude the commentary feed is broken.
 *
 * The rebuild here is about one column that was already in the data and never
 * reached the screen: `team_id`. Every event carried it, and the tab rendered
 * a flat single-column list, so "Yellow card — J. Smith" told a fan nothing
 * about *which side* just went down to ten unless they happened to know the
 * squad by heart. Events now sit on their own club's side of a centre spine,
 * which is how every football timeline a fan has ever read is laid out, and
 * the minute runs down the middle so the two columns stay comparable.
 */

const EVENT_ICON: Record<keyof typeof EVENT_LABEL, LucideIcon> = {
  goal: Volleyball,
  own_goal: Volleyball,
  penalty_goal: Volleyball,
  penalty_missed: CircleSlash,
  yellow_card: RectangleVertical,
  second_yellow_card: RectangleVertical,
  red_card: RectangleVertical,
  substitution: ArrowLeftRight,
  var_review: ScanEye,
};

/** Colour is never the only signal here (directive item 15): each event also
 * carries a distinct icon and its full text label, so a red and a yellow card
 * remain tellable apart without colour vision. */
const EVENT_TONE: Record<keyof typeof EVENT_LABEL, string> = {
  goal: "text-accent",
  own_goal: "text-critical",
  penalty_goal: "text-accent",
  penalty_missed: "text-foreground-subtle",
  yellow_card: "text-warning",
  second_yellow_card: "text-critical",
  red_card: "text-critical",
  substitution: "text-kivo-cyan",
  var_review: "text-foreground-subtle",
};

function MinuteLabel({ event }: { event: MatchEvent }) {
  return (
    <>
      {event.minute}
      {event.addedTime ? `+${event.addedTime}` : ""}&apos;
    </>
  );
}

/**
 * One event's own card, in both layouts.
 *
 * Mobile and desktop are genuinely different here rather than one collapsed
 * into the other (directive item 10). On a phone, two 1fr columns either side
 * of a spine would leave each club about 140px of usable width, which is not
 * enough for "Substitution / A. Player · B. Player", so the mobile layout runs
 * a single left-aligned column and states the club in the card itself. From
 * `sm` up there is room for the real two-sided timeline, the alignment carries
 * the club, and the in-card club line is dropped as redundant.
 */
function TimelineEventCard({
  event,
  side,
  teamName,
  justArrived,
}: {
  event: MatchEvent;
  side: EventSide;
  teamName: string | null;
  /** This event arrived (or was corrected) over Realtime a moment ago. Reuses
   * the same `kivo-row-flash` wash LiveFixtureList uses for a row that just
   * changed, so "something moved" reads identically wherever a fan meets it.
   * Decorative only — the event's own text carries the information, so a
   * reader who never sees the flash loses nothing. globals.css already clamps
   * `animation-duration` globally under prefers-reduced-motion, which is what
   * makes this safe without a per-class opt-out. */
  justArrived: boolean;
}) {
  const Icon = EVENT_ICON[event.eventType];
  const scored = isGoalEventType(event.eventType);

  return (
    <div
      className={[
        "kivo-glass flex items-start gap-2.5 rounded-xl p-3 text-left",
        scored ? "ring-1 ring-accent/25" : "",
        justArrived ? "kivo-row-flash" : "",
        side === "home" ? "sm:flex-row-reverse sm:text-right" : "",

      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${EVENT_TONE[event.eventType]}`} strokeWidth={1.75} aria-hidden />
      <div className="flex min-w-0 flex-col">
        {teamName && (
          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-foreground-subtle sm:hidden">
            {teamName}
          </span>
        )}
        <span className={`text-sm ${scored ? "font-semibold text-foreground" : "text-foreground"}`}>
          {EVENT_LABEL[event.eventType]}
        </span>
        {/* A VAR review, and some cards, arrive with no player attached at
            all. The old copy printed "Unknown player" for those, which reads
            as "KIVO lost the name" when in fact the event never had one — a
            small fabrication in the most-read part of the screen. When there
            is genuinely no player, the detail stands on its own, and when
            there is no detail either the label alone is the whole event. */}
        {(event.playerName || event.relatedPlayerName || event.detail) && (
          <span className="text-xs text-foreground-subtle">
            {event.playerName && (
              <PlayerNameLink
                playerId={event.playerId ?? ""}
                playerName={event.playerName}
                className="hover:text-accent hover:underline"
              />
            )}
            {event.relatedPlayerName ? (
              <>
                {event.playerName ? " · " : ""}
                <PlayerNameLink
                  playerId={event.relatedPlayerId ?? ""}
                  playerName={event.relatedPlayerName}
                  className="hover:text-accent hover:underline"
                />
              </>
            ) : null}
            {event.detail ? `${event.playerName || event.relatedPlayerName ? " · " : ""}${event.detail}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

function TimelineTab({
  events,
  liveIds,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
}: {
  events: MatchEvent[];
  /** Ids that landed over Realtime while this page has been open — the rows
   * that get the brief flash. Empty on a server-rendered load, so opening a
   * finished match never lights up its whole timeline. */
  liveIds: ReadonlySet<string>;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
}) {
  if (events.length === 0) {
    // Two different facts, and KIVO cannot tell them apart from here: a match
    // that genuinely had no goals, cards or substitutions produces exactly the
    // same empty list as one whose details were never synced. The old copy
    // asserted the second, so a real goalless game was reported as missing
    // data. Say both, and say which one KIVO cannot rule out.
    return (
      <EmptyState
        title="Nothing on the timeline yet"
        message="No goals, cards or substitutions on record for this match. That is either a match where none have happened, or one whose events KIVO does not hold — from here those look the same, so it claims neither."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Which column is which club, said once at the top rather than
          repeated on every row — the alignment then carries the meaning for
          the rest of the list. */}
      <div className="hidden grid-cols-[1fr_3rem_1fr] items-center gap-2 px-1 sm:grid">
        <span className="truncate text-right text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          {homeTeamName}
        </span>
        <span aria-hidden className="text-center text-[10px] uppercase tracking-wide text-foreground-subtle">
          min
        </span>
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">
          {awayTeamName}
        </span>
      </div>

      <div className="relative flex flex-col gap-2">
        {/* The spine. Decorative only, and behind the rows: the layout above
            already communicates side without it. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-hairline sm:block"
        />

        {events.map((event, index) => {
          const side = resolveEventSide(event.teamId, homeTeamId, awayTeamId);
          return (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: staggerDelay(index, 0.03), ease: [0.22, 1, 0.36, 1] }}
              className={`relative grid grid-cols-[2.75rem_1fr] items-center gap-2 ${
                // An event with no resolvable club has no side to sit on, so
                // the two-sided desktop layout has nothing to say about it —
                // straddling the spine just looks like a broken row. It keeps
                // the single-column shape at every width instead, which reads
                // as deliberate rather than misplaced.
                side === null ? "" : "sm:grid-cols-[1fr_3rem_1fr]"
              }`}
            >
              {/* A screen reader gets the side as words, since a grid column
                  says nothing when the page is read linearly. */}
              <span className="sr-only">
                {side === "home" ? homeTeamName : side === "away" ? awayTeamName : "Unattributed"},{" "}
                <MinuteLabel event={event} />
              </span>

              {/* DOM order is home / minute / away so the desktop grid places
                  itself with no reordering. On mobile the minute is pulled to
                  the front and the unused side's cell is removed from flow
                  entirely, which is what turns three columns into two. */}
              <div
                className={
                  side === "home"
                    ? "order-2 sm:order-none"
                    : side === null
                      ? // Nothing sits opposite an unattributed event; its row
                        // stays two-column at every width, so there is no third
                        // track for an empty cell to occupy.
                        "hidden"
                      : "hidden sm:block sm:order-none"
                }
                aria-hidden={side !== "home"}
              >
                {side === "home" && (
                  <TimelineEventCard event={event} side="home" teamName={homeTeamName} justArrived={liveIds.has(event.id)} />
                )}
              </div>

              <span
                aria-hidden
                className="z-10 order-1 mx-auto rounded-full border border-hairline bg-surface-1 px-1.5 py-1 text-center text-[11px] font-semibold tabular-nums text-foreground-subtle sm:order-none"
              >
                <MinuteLabel event={event} />
              </span>

              <div
                className={
                  side === "away"
                    ? "order-2 sm:order-none"
                    : side === null
                      ? "order-2"
                      : "hidden sm:block sm:order-none"
                }
                aria-hidden={side === "home"}
              >
                {side === "away" && (
                  <TimelineEventCard event={event} side="away" teamName={awayTeamName} justArrived={liveIds.has(event.id)} />
                )}
                {side === null && (
                  <TimelineEventCard event={event} side={null} teamName={null} justArrived={liveIds.has(event.id)} />
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <p className="px-1 pt-1 text-[11px] leading-relaxed text-foreground-subtle">
        Goals, penalties, cards, substitutions and VAR reviews. KIVO&apos;s provider does not
        publish ball-by-ball commentary, so this is the complete event record for the match
        rather than a shortened one.
      </p>
    </div>
  );
}

/**
 * H2H as a real Match Centre tab.
 *
 * The card itself is unchanged and still shared with /teams/compare — only
 * where it lives moved. Previously it rendered in the fixture page body
 * underneath the whole tab strip, so reaching a section the directive lists
 * next to Stats and Standings meant scrolling past every tab panel first.
 *
 * The tab is only offered when there is a real prior meeting on record (see
 * visibleTabs below), so this component never has to render a zero state for
 * two clubs meeting for the first time.
 */
function HeadToHeadTab({ headToHead }: { headToHead: NonNullable<MatchCentreTabsProps["headToHead"]> }) {
  return <HeadToHeadCard teamA={headToHead.teamA} teamB={headToHead.teamB} record={headToHead.record} />;
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


type StatRow = { key: keyof Omit<TeamStats, "teamId">; label: string; suffix?: string };

/** The eleven a fan scans first. Deliberately short: a long undifferentiated
 * list is how a match report stops being read. */
const STAT_ROWS: StatRow[] = [
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

/**
 * Six columns KIVO has been syncing into `fixture_statistics` and storing on
 * every fixture without ever putting one of them on screen. The whole shot
 * breakdown — where the shots came from and what stopped them — and the raw
 * pass counts underneath the accuracy percentage were all sitting in the
 * database, already paid for in API quota, and unreadable.
 *
 * They go behind a disclosure rather than into the list above, which is the
 * directive's "progressive disclosure for advanced analytics" rather than a
 * compromise: a fan checking possession and shots should not have to scroll
 * past a pass-completion count to do it, and a fan who wants to know that
 * fourteen of the eighteen shots came from outside the box should not have to
 * leave for another app.
 */
const ADVANCED_STAT_ROWS: StatRow[] = [
  { key: "shotsInsideBox", label: "Shots inside box" },
  { key: "shotsOutsideBox", label: "Shots outside box" },
  { key: "shotsOffTarget", label: "Shots off target" },
  { key: "shotsBlocked", label: "Shots blocked" },
  { key: "passesTotal", label: "Passes" },
  { key: "passesAccurate", label: "Accurate passes" },
];

function StatComparisonRow({
  row,
  homeVal,
  awayVal,
  homeTeamName,
  awayTeamName,
}: {
  row: StatRow;
  homeVal: number | null;
  awayVal: number | null;
  homeTeamName: string;
  awayTeamName: string;
}) {
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
  const suffix = row.suffix ?? "";

  return (
    <div className="flex flex-col gap-1.5">
      {/* Read linearly, the visual row is "12 Shots 8" — three numbers and a
          word, with nothing saying which club owns which end. The directive
          asks for accessible charts with textual alternatives; this is that
          alternative, and it names the clubs. The visible row is then hidden
          from assistive tech so the same fact isn't announced twice. */}
      <span className="sr-only">
        {row.label}: {homeTeamName} {homeVal === null ? "not reported" : `${homeVal}${suffix}`}, {awayTeamName}{" "}
        {awayVal === null ? "not reported" : `${awayVal}${suffix}`}
        {total === null ? ". Only reported for one side, so there is nothing to compare." : ""}
      </span>

      <div aria-hidden className="flex items-center justify-between text-xs">
        <span className="w-12 text-left font-semibold text-foreground">
          {homeVal ?? "-"}
          {homeVal !== null ? suffix : ""}
        </span>
        <span className="text-foreground-subtle">{row.label}</span>
        <span className="w-12 text-right font-semibold text-foreground">
          {awayVal ?? "-"}
          {awayVal !== null ? suffix : ""}
        </span>
      </div>

      {total !== null ? (
        <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-surface-inset">
          <div className="kivo-gradient-prime h-full" style={{ width: `${homePct}%` }} />
          <div className="h-full bg-surface-track" style={{ width: `${100 - homePct}%` }} />
        </div>
      ) : (
        <div
          aria-hidden
          className="h-1.5 rounded-full bg-surface-inset"
          title={`${row.label} was only reported for one side, so there is nothing to compare.`}
        />
      )}
    </div>
  );
}

function StatsTab({
  stats,
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
}: {
  stats: TeamStats[];
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
}) {
  const home = stats.find((s) => s.teamId === homeTeamId);
  const away = stats.find((s) => s.teamId === awayTeamId);

  if (!home && !away) {
    return (
      <EmptyState
        title="No match statistics yet"
        message="Team statistics are published once a match is under way, and KIVO holds none for this fixture."
      />
    );
  }

  const hasValue = (row: StatRow) => home?.[row.key] != null || away?.[row.key] != null;
  const rows = STAT_ROWS.filter(hasValue);
  const advancedRows = ADVANCED_STAT_ROWS.filter(hasValue);

  function renderRow(row: StatRow) {
    return (
      <StatComparisonRow
        key={row.key}
        row={row}
        homeVal={home?.[row.key] ?? null}
        awayVal={away?.[row.key] ?? null}
        homeTeamName={homeTeamName}
        awayTeamName={awayTeamName}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-4">{rows.map(renderRow)}</div>

      {/* Only offered when the provider actually reported at least one of
          them for this fixture — an empty disclosure that opens onto nothing
          is worse than no disclosure. A native <details> rather than a
          hand-rolled toggle: keyboard operation, the open/closed state and
          the expanded announcement all come for free and correctly. */}
      {advancedRows.length > 0 && (
        <details className="kivo-glass group rounded-2xl p-4 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            Advanced
            <ChevronDown
              aria-hidden
              className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180"
              strokeWidth={1.75}
            />
          </summary>
          <div className="flex flex-col gap-4 pt-4">{advancedRows.map(renderRow)}</div>
        </details>
      )}
    </div>
  );
}

function StandingsTab({ standings, homeTeamId, awayTeamId }: { standings: StandingsRow[]; homeTeamId: string; awayTeamId: string }) {
  if (standings.length === 0) {
    return (
      <EmptyState
        title="No table for this competition yet"
        message="A league table needs a full season's results behind it. KIVO doesn't hold one for this competition, so it shows nothing rather than a table it would have to invent."
      />
    );
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
        {/* The three tabs that are always offered, whatever this fixture
            holds — so the strip the reader sees for a frame is the strip they
            get, rather than five labels that then disappear. */}
        {ALWAYS_TABS.map((tab) => (
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
  viewer,
  canSyncDetails,
  syncDetailsAction,
  detailsLastSyncedAt,
  preMatch,
  homeScore,
  awayScore,
  homeForm,
  awayForm,
  homeManager,
  awayManager,
  roomWindow,
  headToHead,
  competitionCoverage,
}: MatchCentreTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The hero above these tabs has been Realtime-driven since migration 0038,
  // so the score already ticked over on a goal while the timeline underneath
  // still claimed nothing had happened. Same publication, nothing was
  // subscribed to it. Only live while the match can still produce events —
  // see the hook's own `enabled` note.
  const { events: liveEvents, liveIds } = useRealtimeFixtureEvents(
    fixtureId,
    events,
    preMatch.status === "scheduled" || isLiveStatus(preMatch.status),
  );

  // Built once, here, and used for two things: whether the Heatmap tab is
  // offered at all, and what that tab then renders. That is the whole point —
  // the tab was hardcoded unavailable precisely because availability and
  // content were separate questions that could disagree, and the obvious fix
  // (offer it whenever a lineup exists) would have reintroduced the same bug
  // in reverse, since a published lineup does not mean a single player could
  // actually be anchored on the pitch. `hasFixtureHeatmapContent` asks about
  // the very object the view is about to draw, so the tab strip cannot promise
  // something the panel then fails to show.
  const heatmaps = buildFixtureHeatmaps({ fixtureId, homeTeamId, awayTeamId, lineups, events });

  // The two team sheets, built once here from the lineup rows and the *live*
  // event list — so a substitution or a goal arriving over Realtime moves the
  // Lineups tab's markers at the same moment it moves the Timeline, rather
  // than leaving the two panels of the same page disagreeing about the match
  // they are both describing.
  const fantasyRosterByPlayerId = new Map(viewerFantasyRoster.map((entry) => [entry.playerId, entry.isCaptain]));

  const homeSheet = buildTeamSheet(homeTeamId, lineups, liveEvents);
  const awaySheet = buildTeamSheet(awayTeamId, lineups, liveEvents);

  // KIVO's own ratings. The engine refuses everything that is not a finished
  // match with a real final score, so on a live or scheduled fixture both of
  // these come back empty and the Ratings tab is simply not offered — no
  // provisional number is ever shown and then revised.
  const homeRated = rateTeamSheet(homeSheet, {
    fixtureId,
    fixtureStatus: preMatch.status,
    goalsFor: homeScore,
    goalsAgainst: awayScore,
  });
  const awayRated = rateTeamSheet(awaySheet, {
    fixtureId,
    fixtureStatus: preMatch.status,
    goalsFor: awayScore,
    goalsAgainst: homeScore,
  });
  const ratings = new Map([...ratingsByPlayerId(homeRated), ...ratingsByPlayerId(awayRated)]);
  const homeRanked = rankRatedPlayers(homeRated);
  const awayRanked = rankRatedPlayers(awayRated);
  const standout = pickStandoutPlayer([
    { teamId: homeTeamId, rated: homeRated },
    { teamId: awayTeamId, rated: awayRated },
  ]);
  const unratedCount = [...homeRated, ...awayRated].filter((entry) => entry.rating === null).length;

  // KN-53's rule, kept: a deep tab earns its place by holding data.
  const dataTabAvailability: Record<(typeof DATA_TABS)[number], boolean> = {
    Timeline: liveEvents.length > 0,
    Lineups: lineups.length > 0,
    Ratings: homeRanked.length > 0 || awayRanked.length > 0,
    Stats: stats.length > 0,
    Heatmap: hasFixtureHeatmapContent(heatmaps),
  };
  const availableDataTabs = DATA_TABS.filter((tab) => dataTabAvailability[tab]);
  // What the Overview panel names in its one sentence about what is missing.
  // Ratings is excluded on purpose: it is KIVO's own computation rather than
  // something waiting to arrive, and before full time its absence is a
  // deliberate refusal, not a gap.
  const missingAreas = DATA_TABS.filter(
    (tab) => tab !== "Ratings" && tab !== "Heatmap" && !dataTabAvailability[tab],
  ).map((tab) => MISSING_AREA_LABEL[tab]);

  // H2H is not a deep tab in that sense — it is computed from finished
  // fixtures KIVO already holds, not from this fixture's own detail — so it
  // is offered whenever both clubs resolved, including on a scheduled match
  // where every other deep tab is empty. It used to require a prior meeting
  // on record, which with almost no history meant it never appeared at all;
  // HeadToHeadCard has always had an honest zero state and now gets to use it.
  const hasHeadToHead = headToHead !== null;

  const visibleTabs: Tab[] = [
    "Overview",
    ...availableDataTabs,
    ...(hasHeadToHead ? (["H2H"] as const) : []),
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
      {(active === "Overview" || active === "Timeline" || active === "Stats" || active === "Lineups" || active === "Ratings") && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
          {/* LastSyncedNote renders nothing at all without a timestamp now, so
              this no longer needs its own guard — the freshness line is simply
              absent on a fixture nothing has been fetched for. */}
          <LastSyncedNote timestamp={detailsLastSyncedAt} />
          {canSyncDetails && <FixtureDetailsSyncControl action={syncDetailsAction} />}
        </div>
      )}

      {/* KN-35. This was `<AnimatePresence mode="wait">` with an exit
          transition, which is exactly the pattern RECOMMENDATIONS.md item 75
          removed from page navigation (page-transition.tsx is enter-only now)
          and for exactly the same reason: `mode="wait"` holds the INCOMING
          panel back until the outgoing one has finished animating out, so
          every tap costs the exit duration before anything new can even begin
          to appear. On page navigation that read as sluggishness; here it is
          worse, because this is the most-tapped control in the product and a
          tab switch is meant to feel instant, not narrated.

          Enter-only, keyed on the active tab: the new panel starts rendering
          immediately and fades up, and the old one is simply gone. Motion still
          communicates state (something changed, and in which direction) without
          charging the user for the transition out of content they have already
          decided to leave. */}
      <motion.div
        key={active}
        role="tabpanel"
        id={`match-centre-panel-${tabSlug(active)}`}
        aria-labelledby={`match-centre-tab-${tabSlug(active)}`}
        tabIndex={0}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      >
        {active === "Overview" && (
          <MatchOverview
            facts={preMatch}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
            events={liveEvents}
            homeForm={homeForm}
            awayForm={awayForm}
            headToHead={headToHead?.record ?? null}
            standings={standings}
            competitionCoverage={competitionCoverage}
            missingAreas={missingAreas}
            // The Overview's own deep links move the tab strip rather than
            // navigating, so a fan who taps "Full table" lands on the tab they
            // asked for with the same shallow URL update every other tab uses.
            onOpenTab={(tab) => {
              if (visibleTabs.includes(tab)) {
                setActive(tab);
                tabRefs.current[tab]?.focus();
              }
            }}
          />
        )}
        {active === "Timeline" && (
          <TimelineTab
            events={liveEvents}
            liveIds={liveIds}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
          />
        )}
        {active === "Stats" && (
          <StatsTab
            stats={stats}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
          />
        )}
        {active === "Lineups" && (
          <TeamSheetView
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
            homeSheet={homeSheet}
            awaySheet={awaySheet}
            homeManager={homeManager}
            awayManager={awayManager}
            ratings={ratings}
            viewerFantasyRoster={fantasyRosterByPlayerId}
            renderBadge={(playerId) =>
              fantasyRosterByPlayerId.has(playerId) ? (
                <InYourXIBadge isCaptain={Boolean(fantasyRosterByPlayerId.get(playerId))} />
              ) : null
            }
          />
        )}
        {active === "Ratings" && (
          <PlayerRatingsView
            homeTeamName={homeTeamName}
            awayTeamName={awayTeamName}
            homeRated={homeRanked}
            awayRated={awayRanked}
            standout={standout}
            homeTeamId={homeTeamId}
            unratedCount={unratedCount}
          />
        )}
        {active === "Heatmap" && (
          <HeatmapView heatmaps={heatmaps} homeTeamName={homeTeamName} awayTeamName={awayTeamName} />
        )}
        {active === "H2H" && headToHead && <HeadToHeadTab headToHead={headToHead} />}
        {active === "Standings" && <StandingsTab standings={standings} homeTeamId={homeTeamId} awayTeamId={awayTeamId} />}
        {active === "Room" && (
          <MatchRoomTab
              fixtureId={fixtureId}
              signedIn={signedIn}
              viewer={viewer}
              posts={roomPosts}
              scrollToPostId={scrollToPostId}
              // KN-100: the poll templates need the two real club names and
              // whether the match has finished. Passed down rather than
              // re-fetched — this component already has both.
              homeTeamName={homeTeamName}
              awayTeamName={awayTeamName}
              isFinished={preMatch.status === "finished"}
              // The Room opens the moment the fixture exists and closes a day
              // after full time. Derived on the server so the hydration render
              // cannot disagree with it, then kept live in the browser.
              kickoffAt={preMatch.kickoffAt}
              status={preMatch.status}
              serverWindow={roomWindow}
            />
        )}
      </motion.div>
    </div>
  );
}
