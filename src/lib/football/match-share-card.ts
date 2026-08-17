import type { Database } from "@/lib/supabase/types";
import { STATUS_LABEL, formatKickoff, type FixtureStatus } from "@/lib/football/fixture-status";

// No "server-only" here (unlike match-share-card-data.ts): the on-page
// <MatchShareCard> preview is a client component (it needs the download/share
// button interactivity) and imports the pure pieces below directly, so this
// module has to stay importable from client code.

export type MatchShareCardState = "upcoming" | "live" | "finished";

export type MatchShareCardTeam = {
  id: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
};

/** A single real goal-type event (goal/penalty_goal/own_goal — never a
 * fabricated one), already resolved to a display-ready player name and
 * grouped onto the scoring side. */
export type MatchShareCardGoalEvent = {
  minute: number;
  addedTime: number | null;
  playerName: string;
  isOwnGoal: boolean;
};

export type MatchShareCardData = {
  state: MatchShareCardState;
  /** Template-matching label: "FULL TIME", "LIVE", "HALF TIME", "KICK-OFF", etc. */
  statusLabel: string;
  /** Only set while state === "live" (e.g. "67'"). */
  minuteLabel: string | null;
  competitionName: string;
  venueLabel: string | null;
  kickoffLabel: string;
  homeTeam: MatchShareCardTeam;
  awayTeam: MatchShareCardTeam;
  homeScore: number | null;
  awayScore: number | null;
  /** Capped to MAX_EVENTS_PER_SIDE, oldest first, exactly matching the
   * template's own two-column goal-list layout. */
  homeGoalEvents: MatchShareCardGoalEvent[];
  awayGoalEvents: MatchShareCardGoalEvent[];
};

export const MAX_EVENTS_PER_SIDE = 3;

const GOAL_EVENT_TYPES = new Set<Database["public"]["Enums"]["fixture_event_type"]>([
  "goal",
  "penalty_goal",
  "own_goal",
]);

export type MatchShareCardFixtureInput = {
  status: FixtureStatus;
  kickoff_at: string;
  home_score: number | null;
  away_score: number | null;
  minute_elapsed: number | null;
  competition: { name: string; short_name: string | null } | null;
  venue: { name: string | null; city: string | null } | null;
  home_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
  away_team: { id: string; name: string; short_name: string | null; crest_url: string | null } | null;
};

export type MatchShareCardEventInput = {
  event_type: Database["public"]["Enums"]["fixture_event_type"];
  minute: number;
  added_time: number | null;
  team_id: string;
  player_name: string | null;
};

function stateForStatus(status: FixtureStatus): MatchShareCardState {
  if (status === "live" || status === "halftime") return "live";
  if (status === "finished" || status === "abandoned") return "finished";
  return "upcoming";
}

/**
 * Pure transform from real fixture + fixture_events rows into the exact
 * shape MatchShareCard (the live preview) and the /share-card image route
 * both render — a single source of truth so the on-page component and the
 * downloadable PNG can never drift apart. Never invents a score, event, or
 * team: every field here is either a real column value or a template-side
 * literal like "FULL TIME"/"VS".
 */
export function buildMatchShareCardData(
  fixture: MatchShareCardFixtureInput,
  events: MatchShareCardEventInput[],
): MatchShareCardData {
  const state = stateForStatus(fixture.status);

  const statusLabel =
    state === "upcoming"
      ? "KICK-OFF"
      : state === "live"
        ? fixture.status === "halftime"
          ? "HALF TIME"
          : "LIVE"
        : STATUS_LABEL[fixture.status].toUpperCase() === "FT"
          ? "FULL TIME"
          : STATUS_LABEL[fixture.status].toUpperCase();

  const minuteLabel = state === "live" && fixture.minute_elapsed != null ? `${fixture.minute_elapsed}'` : null;

  const homeTeam: MatchShareCardTeam = {
    id: fixture.home_team?.id ?? "",
    name: fixture.home_team?.name ?? "Home",
    shortName: fixture.home_team?.short_name ?? null,
    crestUrl: fixture.home_team?.crest_url ?? null,
  };
  const awayTeam: MatchShareCardTeam = {
    id: fixture.away_team?.id ?? "",
    name: fixture.away_team?.name ?? "Away",
    shortName: fixture.away_team?.short_name ?? null,
    crestUrl: fixture.away_team?.crest_url ?? null,
  };

  const goalEvents = events
    .filter((e) => GOAL_EVENT_TYPES.has(e.event_type) && e.player_name)
    .sort((a, b) => a.minute - b.minute || (a.added_time ?? 0) - (b.added_time ?? 0));

  const toDisplayEvent = (e: MatchShareCardEventInput): MatchShareCardGoalEvent => ({
    minute: e.minute,
    addedTime: e.added_time,
    playerName: e.player_name!,
    isOwnGoal: e.event_type === "own_goal",
  });

  const homeGoalEvents = goalEvents.filter((e) => e.team_id === homeTeam.id).map(toDisplayEvent).slice(0, MAX_EVENTS_PER_SIDE);
  const awayGoalEvents = goalEvents.filter((e) => e.team_id === awayTeam.id).map(toDisplayEvent).slice(0, MAX_EVENTS_PER_SIDE);

  const venueLabel = fixture.venue?.name ? [fixture.venue.name, fixture.venue.city].filter(Boolean).join(", ") : null;

  return {
    state,
    statusLabel,
    minuteLabel,
    competitionName: fixture.competition?.short_name ?? fixture.competition?.name ?? "KIVO",
    venueLabel,
    kickoffLabel: formatKickoff(fixture.kickoff_at, { includeWeekday: true }),
    homeTeam,
    awayTeam,
    homeScore: state === "upcoming" ? null : fixture.home_score,
    awayScore: state === "upcoming" ? null : fixture.away_score,
    homeGoalEvents,
    awayGoalEvents,
  };
}

/**
 * Pixel geometry for kivo-match-card-background.webp's own baked artwork
 * (a fixed 1536x1024 canvas — see the asset itself). The template bakes in
 * placeholder pixels for the status label, "2 - 1" score and two example
 * goal rows (RECOMMENDATIONS items 231/232's sibling asset note: "generic
 * team shields, placeholder text ... use as-is, never crop or slice it") —
 * real data can't just be drawn transparently on top of those without the
 * baked placeholder showing through underneath it, so the boxes below mark
 * exactly where an opaque KIVO glass-chip panel needs to sit to fully
 * replace each one. The shield outlines themselves need no such cover: their
 * interior is already empty/transparent in the artwork, so a crest image
 * drops straight in. Both <MatchShareCard> (CSS %, responsive) and the
 * /share-card PNG route (raw px, fixed 1536x1024 canvas) position off this
 * single shared source so they can never drift apart.
 */
export const MATCH_CARD_CANVAS = { width: 1536, height: 1024 } as const;

export const MATCH_CARD_LAYOUT = {
  statusPill: { top: 96, left: 578, width: 380, height: 58 },
  scorePanel: { top: 210, left: 480, width: 576, height: 200 },
  shieldLeft: { top: 172, left: 160, width: 270, height: 292 },
  shieldRight: { top: 172, left: 1106, width: 270, height: 292 },
  teamNameLeft: { top: 78, left: 60, width: 360, height: 40 },
  teamNameRight: { top: 78, left: 1116, width: 360, height: 40 },
  eventsLeft: { top: 460, left: 350, width: 380, height: 250 },
  eventsRight: { top: 460, left: 806, width: 380, height: 250 },
  caption: { top: 660, left: 218, width: 1100, height: 60 },
  watermark: { top: 954, left: 1290, width: 190, height: 36 },
} as const;
