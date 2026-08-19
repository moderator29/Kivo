import { currentProviderSeason } from "./target-season";

/**
 * KIVO's centralized answer to "which season is it".
 *
 * WHY THIS EXISTS SEPARATELY FROM target-season.ts
 * ---------------------------------------------------------------------------
 * `target-season.ts` answers ONE question — which season year does KIVO ask the
 * provider for, given an operator override, an environment variable, or the
 * calendar. That is a policy question about configuration, and it is already
 * solved. This module answers the football questions around it: what came
 * before, what comes next, when does a season start and end, and how is it
 * written down for a human.
 *
 * They are deliberately not merged. One is about what KIVO is configured to
 * fetch; the other is about how football's calendar works. If they were one
 * module, every consumer that wanted "the label for 2024/25" would drag in a
 * database read and an override policy it does not care about.
 *
 * NOTHING HERE HARDCODES A YEAR. The founder's instruction was explicit — "Do
 * not hardcode 2024 or 2025. The system must transition automatically as new
 * seasons begin." Every function below takes `now` (or a season year) and
 * derives its answer, so the tests can move through time and August 2027 needs
 * no code change.
 *
 * THE NORTHERN-HEMISPHERE ASSUMPTION, STATED RATHER THAN HIDDEN
 * ---------------------------------------------------------------------------
 * A "season year" of 2024 means the 2024/25 season, running roughly July 2024
 * to June 2025. That is how Europe's leagues run and how both providers label
 * them, and it is the convention `currentProviderSeason` already encodes.
 *
 * It is WRONG for leagues that play a single calendar year — MLS, the J1
 * League, most of Scandinavia, the NPFL in some formats. For those, 2024 means
 * 2024 and there is no "/25". KIVO cannot tell which convention a competition
 * uses without the provider saying so, and the provider does say so: a season
 * carries real start and end dates. So `seasonLabel` takes an optional pair of
 * real dates and uses them when they exist, falling back to the European
 * convention only when nothing better is known — and `isSingleYearSeason`
 * exists so a caller can ask rather than assume.
 *
 * The important part is that the fallback is a LABEL, not a fetch. Getting a
 * label slightly wrong prints "2024/25" where "2024" was meant. Getting a
 * fetched season wrong returns a different season's data and looks completely
 * normal, which is why the fetched year goes through target-season.ts and its
 * override flag rather than through anything here.
 */

/** Where a season sits relative to the one KIVO is currently pointed at. */
export type SeasonPosition = "previous" | "current" | "upcoming";

export interface SeasonWindow {
  /** The provider's season year: 2024 means the 2024/25 European season. */
  seasonYear: number;
  /** How a human writes it. */
  label: string;
  /** Where it sits relative to the current one. */
  position: SeasonPosition;
}

/**
 * The month a European season is taken to begin, 0-based for `Date`.
 *
 * July, matching `currentProviderSeason`'s own boundary. The two MUST agree:
 * if this said August while that said July, then every day in July would be
 * fetched as one season and labelled as another, which is the least debuggable
 * class of off-by-one there is.
 */
const SEASON_START_MONTH = 6;

/**
 * How a season is written when KIVO has no real dates for it.
 *
 * `2024` becomes "2024/25". The second half is two digits because that is how
 * every football surface in the world writes it, and the century rollover is
 * handled by the modulo rather than by string slicing — "2099/00" is correct
 * and "2099/0" would not be.
 */
export function seasonLabel(
  seasonYear: number,
  dates?: { startsOn?: string | null; endsOn?: string | null },
): string {
  if (dates && isSingleYearSeason(dates)) return String(seasonYear);
  const next = (seasonYear + 1) % 100;
  return `${seasonYear}/${String(next).padStart(2, "0")}`;
}

/**
 * True when a season's real dates show it inside one calendar year — MLS, J1,
 * the Scandinavian leagues.
 *
 * Answered only from dates the provider actually supplied. With no dates the
 * answer is `false`, which is not a claim that the competition spans two years
 * so much as a statement that KIVO has nothing to say and will use the common
 * convention. A caller that needs certainty should check for the dates itself.
 */
export function isSingleYearSeason(dates: { startsOn?: string | null; endsOn?: string | null }): boolean {
  const start = dates.startsOn ? new Date(dates.startsOn) : null;
  const end = dates.endsOn ? new Date(dates.endsOn) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return start.getUTCFullYear() === end.getUTCFullYear();
}

/**
 * The season before, the season now, and the season next — derived, never
 * stored.
 *
 * "Upcoming" is genuinely the next one and not a guess about whether it has
 * started: a caller asking for the upcoming season in March wants next season,
 * and a caller asking in August wants the one after the one now under way. The
 * boundary is `currentProviderSeason`'s, so there is exactly one place in the
 * codebase where July becomes a new season.
 */
export function seasonWindow(now: Date = new Date()): {
  previous: SeasonWindow;
  current: SeasonWindow;
  upcoming: SeasonWindow;
} {
  const current = currentProviderSeason(now);
  return {
    previous: { seasonYear: current - 1, label: seasonLabel(current - 1), position: "previous" },
    current: { seasonYear: current, label: seasonLabel(current), position: "current" },
    upcoming: { seasonYear: current + 1, label: seasonLabel(current + 1), position: "upcoming" },
  };
}

/**
 * Where a season year sits relative to today.
 *
 * Anything older than last season is still reported as "previous" rather than
 * gaining a fourth bucket. A consumer that cares how far back it is has the
 * number and can subtract; the three-way answer exists for the surfaces that
 * only need to know which direction they are looking.
 */
export function seasonPosition(seasonYear: number, now: Date = new Date()): SeasonPosition {
  const current = currentProviderSeason(now);
  if (seasonYear > current) return "upcoming";
  if (seasonYear < current) return "previous";
  return "current";
}

/**
 * The default date range for a season year, for the case where the provider
 * supplied none.
 *
 * **This is an approximation and every caller must treat it as one.** Real
 * seasons do not start on 1 July: the Premier League starts in mid-August, the
 * Bundesliga later, a cup earlier. This exists so a fixture query has sane
 * bounds when nothing better is known, NOT so a UI can print "the season runs
 * from 1 July".
 *
 * It is deliberately generous at both ends — a whole calendar year from 1 July
 * — because the failure modes are asymmetric. Too wide catches a pre-season
 * friendly that arguably belongs to the season anyway; too narrow silently
 * drops a real fixture played in a window nobody predicted, and a missing
 * fixture is indistinguishable from a fixture that was never played.
 */
export function approximateSeasonRange(seasonYear: number): { startsOn: string; endsOn: string } {
  const start = new Date(Date.UTC(seasonYear, SEASON_START_MONTH, 1));
  const end = new Date(Date.UTC(seasonYear + 1, SEASON_START_MONTH, 0));
  return { startsOn: toIsoDate(start), endsOn: toIsoDate(end) };
}

/**
 * The season year a date falls in, using the same July boundary as everything
 * else here.
 *
 * Useful for filing a fixture whose provider payload carries a kickoff but no
 * season — which happens on date-scoped endpoints, where the response is "what
 * is on today" and nobody mentions a season at all.
 */
export function seasonYearForDate(date: Date): number {
  return currentProviderSeason(date);
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
