import type { FixtureStatus } from "./fixture-status";

/**
 * Which sections the Match Centre offers for one fixture, and why.
 *
 * ## The bug this exists to end
 *
 * The rule used to be "a deep tab earns its place by holding data". Read on
 * its own that sounds like honesty, and half of it is: a tab strip that
 * promises five sections and delivers the same apology behind all five charges
 * a fan five taps for one fact.
 *
 * But it conflated two completely different absences, and the founder found
 * the seam immediately — "lineup not showing or working". A team sheet that
 * has not been published yet is *not* a section that does not exist. It is the
 * single most anticipated thing on a match page in the hour before kick-off,
 * and hiding it means the one question a fan came to ask has no place on the
 * screen to be asked. Meanwhile the thing that genuinely cannot fill — a
 * competition whose data source publishes no line-ups at all, ever — looked
 * exactly the same.
 *
 * `provider_coverage` (migration 0082) is the only thing that can tell those
 * two apart, and it is deliberately three-valued: `true` supported, `false`
 * the source says never, `null` nothing is known. So:
 *
 *   - **holds data** → offered, populated.
 *   - **holds nothing, coverage says `false`** → not offered at all. It will
 *     never fill, and a tab that can never fill is a lie with a chevron on it.
 *   - **holds nothing, coverage `true` or `null`** → offered, with an empty
 *     state that says when the thing normally exists. `null` is not a denial
 *     and is never rendered as one.
 *
 * ## The second axis: the clock
 *
 * Coverage answers "does this competition publish it". The fixture's own
 * status answers "could it exist yet". No match has a timeline or a statistic
 * before kick-off — not because KIVO is missing them, but because they have
 * not happened. Those two sections therefore appear at kick-off. Line-ups run
 * the other way: they exist *before* the match, so that tab is offered from
 * the moment the fixture is on the calendar.
 *
 * A match that will never be played (postponed, cancelled) is offered neither.
 * Nothing further is coming for it, which is the same test as coverage `false`.
 *
 * ## What is never soft-gated
 *
 * Ratings, the touch map and per-player numbers are computations KIVO performs
 * or numbers it has been given, not things it is waiting on. They appear when
 * they are real and are silently absent otherwise — there is no "coming soon"
 * for a number nobody is going to send.
 */

export const MATCH_CENTRE_TABS = [
  "overview",
  "timeline",
  "lineups",
  "ratings",
  "stats",
  "players",
  "heatmap",
  "h2h",
  "standings",
  "room",
] as const;

export type MatchCentreTab = (typeof MATCH_CENTRE_TABS)[number];

/** What a fan calls each section. The id is the slug that ends up in the URL
 * and must stay stable — `?tab=standings` is in links people have already
 * shared — so the words on screen are kept separate from it and can be said
 * the way football says them. */
export const MATCH_CENTRE_TAB_LABEL: Record<MatchCentreTab, string> = {
  overview: "Overview",
  timeline: "Timeline",
  lineups: "Line-ups",
  ratings: "Ratings",
  stats: "Stats",
  players: "Players",
  heatmap: "Touch map",
  h2h: "H2H",
  standings: "Table",
  room: "Room",
};

/** Slugs that used to name a section and still appear in links people have
 * shared. "details" always rendered the events in minute order; the name just
 * never said so. */
export const MATCH_CENTRE_LEGACY_SLUGS: Readonly<Record<string, MatchCentreTab>> = { details: "timeline" };

/** What this fixture actually holds, right now. Every field is a fact about
 * rows KIVO has, never about rows it expects. */
export type MatchDataPresence = {
  timeline: boolean;
  lineups: boolean;
  ratings: boolean;
  stats: boolean;
  players: boolean;
  heatmap: boolean;
  standings: boolean;
  headToHead: boolean;
};

/** The data source's own statement about this fixture's competition, passed
 * through untouched. `null` for the whole object means the registry has never
 * been read for it; `null` for a field means it said nothing about that one. */
export type MatchCompetitionCoverage = {
  events: boolean | null;
  lineups: boolean | null;
  statistics: boolean | null;
  standings: boolean | null;
} | null;

/** True once the match has started, in the sense that matters here: events and
 * statistics can now exist. Halftime counts; a match called off does not. */
export function hasKickedOff(status: FixtureStatus): boolean {
  return status === "live" || status === "halftime" || status === "finished" || status === "abandoned";
}

/** A fixture that is not going to produce anything further. Nothing is waiting
 * to arrive for it, so nothing is offered on the promise that it might. */
export function isCalledOff(status: FixtureStatus): boolean {
  return status === "postponed" || status === "cancelled";
}

export function resolveVisibleMatchTabs({
  status,
  present,
  coverage,
}: {
  status: FixtureStatus;
  present: MatchDataPresence;
  coverage: MatchCompetitionCoverage;
}): MatchCentreTab[] {
  const started = hasKickedOff(status);
  const calledOff = isCalledOff(status);

  /** Offered when it holds something; otherwise only while it still might. */
  function waiting(has: boolean, supported: boolean | null, couldExistYet: boolean): boolean {
    if (has) return true;
    if (supported === false) return false;
    if (calledOff) return false;
    return couldExistYet;
  }

  const tabs: MatchCentreTab[] = ["overview"];

  if (waiting(present.timeline, coverage?.events ?? null, started)) tabs.push("timeline");
  if (waiting(present.lineups, coverage?.lineups ?? null, true)) tabs.push("lineups");
  if (present.ratings) tabs.push("ratings");
  if (waiting(present.stats, coverage?.statistics ?? null, started)) tabs.push("stats");
  if (present.players) tabs.push("players");
  if (present.heatmap) tabs.push("heatmap");
  if (present.headToHead) tabs.push("h2h");
  // A table is the one section whose absence is not about this fixture at all.
  // It is offered whenever the competition is one that has a table — which is
  // exactly what a `false` here denies, and nothing else does.
  if (present.standings || (coverage?.standings ?? null) !== false) tabs.push("standings");
  tabs.push("room");

  return tabs;
}
