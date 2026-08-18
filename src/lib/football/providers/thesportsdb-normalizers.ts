/**
 * Pure, provider-quirk-encoding normalizers used by the TheSportsDB adapter
 * (providers/thesportsdb.ts). Split into their own module — deliberately
 * without a "server-only" import — so they stay importable from unit tests
 * without dragging in thesportsdb.ts's server-only fetch/env dependencies.
 * Mirrors ./normalizers.ts's split for exactly the same reason stated there:
 * a regression in a status/type mapping silently corrupts stored data, so
 * these are worth testing in isolation.
 */
import type { NormalizedFixture } from "../types";
import { parseMatchday } from "../matchday";

export interface TheSportsDbEvent {
  idEvent: string;
  strEvent: string | null;
  idLeague: string | null;
  strLeague: string | null;
  strSeason: string | null;
  dateEvent: string | null;
  strTime: string | null;
  strTimestamp: string | null;
  strStatus: string | null;
  /** Bare numeric round ("12"), when the free tier reports one at all. Read
   * defensively for the same reason as the badge fields below. */
  intRound?: string | null;
  idHomeTeam: string | null;
  idAwayTeam: string | null;
  strHomeTeam: string | null;
  strAwayTeam: string | null;
  /** Unconfirmed on the free tier — read defensively, never assumed present. */
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  intHomeScore: string | null;
  intAwayScore: string | null;
  idVenue: string | null;
  strVenue: string | null;
}

/** Parses a value TheSportsDB may return as either a numeric string or a real
 * number (both appear across its endpoints, undocumented which per field) —
 * never assumes, always coerces defensively. Missing/non-numeric becomes
 * null, same "not reported" convention as normalizers.ts's parseStatNumber. */
export function toNumberOrNull(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  // `Number("")` is 0 in JS, which would silently turn "no value reported" into
  // a fabricated real score/stat of zero — an empty string is treated the same
  // as null/undefined here, not as a numeric input.
  if (typeof value === "string" && value.trim().length === 0) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toIntOrZero(value: string | number | null | undefined): number {
  return toNumberOrNull(value) ?? 0;
}

/**
 * Maps TheSportsDB's free-text `strStatus` onto our fixture_status enum.
 * TheSportsDB's status reporting is honestly less reliable/consistent than
 * API-Football's on the free tier — plenty of real, finished historical
 * fixtures come back with an empty or unrecognized strStatus despite having
 * real scores. Rather than infer "finished" from the presence of a score
 * (which would be a guess about *why* the field is empty, not a mapping),
 * unrecognized/empty status honestly lands on "unknown" per FixtureStatus's
 * own doc comment — the same bucket API-Football's mapStatus() uses for a
 * code it doesn't recognize.
 */
export function mapTheSportsDbStatus(rawStatus: string | null): NormalizedFixture["status"] {
  const status = (rawStatus ?? "").trim().toLowerCase();
  if (status.length === 0) return "unknown";
  if (["ns", "not started"].includes(status)) return "scheduled";
  if (["1h", "2h", "live", "in play", "et"].includes(status)) return "live";
  if (status === "ht" || status === "halftime") return "halftime";
  if (["ft", "match finished", "finished", "aet", "after extra time", "pen"].includes(status)) return "finished";
  if (["postponed", "pst"].includes(status)) return "postponed";
  if (["cancelled", "canceled", "canc"].includes(status)) return "cancelled";
  if (["abandoned", "abd", "suspended"].includes(status)) return "abandoned";
  return "unknown";
}

/** Extracts a 4-digit season-start year from TheSportsDB's "YYYY-YYYY"-style
 * strSeason string (e.g. "2024-2025" -> 2024). Falls back to the fixture's
 * own kickoff-date year when strSeason is missing or unparseable — derived
 * from a real field on the same event, not invented — since NormalizedFixture
 * requires a non-null season number. */
export function parseSeasonYear(strSeason: string | null, fallbackDateIso: string | null): number {
  const match = strSeason?.match(/^(\d{4})/);
  if (match) return Number(match[1]);
  const fallbackYear = fallbackDateIso ? new Date(fallbackDateIso).getFullYear() : NaN;
  return Number.isFinite(fallbackYear) ? fallbackYear : new Date().getFullYear();
}

/** TheSportsDB's most common season string convention for European-style
 * split-year leagues. NOT correct for calendar-year leagues (e.g. MLS,
 * Brazilian Série A use a single year like "2026") — this adapter has no
 * per-league season-format table to consult, so it makes the European-style
 * assumption and documents it here rather than silently guessing per call
 * site. Verify against a real response for any non-European competition
 * before trusting getStandings() for it. */
export function toTheSportsDbSeasonString(season: number): string {
  return `${season}-${season + 1}`;
}

export function buildEventKickoffIso(dateEvent: string | null, strTime: string | null, strTimestamp: string | null): string {
  if (strTimestamp) {
    const parsed = new Date(strTimestamp);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (dateEvent) {
    const time = strTime && strTime.trim().length > 0 ? strTime : "00:00:00";
    const parsed = new Date(`${dateEvent}T${time}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  // No parseable date at all on this event — should not happen for a real
  // TheSportsDB event, but NormalizedFixture.kickoffAt is non-nullable, so
  // this is the documented last resort rather than a thrown error for one
  // malformed row in a larger batch.
  return new Date(0).toISOString();
}

export function mapEvent(item: TheSportsDbEvent): NormalizedFixture {
  const kickoffAt = buildEventKickoffIso(item.dateEvent, item.strTime, item.strTimestamp);
  return {
    provider: "thesportsdb",
    providerId: item.idEvent,
    competitionProviderId: item.idLeague ?? "",
    competitionName: item.strLeague ?? "Unknown competition",
    season: parseSeasonYear(item.strSeason, kickoffAt),
    kickoffAt,
    status: mapTheSportsDbStatus(item.strStatus),
    // TheSportsDB reports the round as a bare numeric string in `intRound`
    // rather than as a label. `parseMatchday` requires a separator or keyword
    // precisely so a bare number is never guessed at, so this prefixes the
    // provider's own word for it rather than loosening that rule for everyone.
    matchday: parseMatchday(item.intRound ? `Round ${item.intRound}` : null),
    // Not reliably available on the free tier — see thesportsdb.ts's top comment.
    minute: null,
    homeTeam: {
      providerId: item.idHomeTeam ?? "",
      name: item.strHomeTeam ?? "Unknown",
      shortName: null,
      crestUrl: item.strHomeTeamBadge ?? null,
    },
    awayTeam: {
      providerId: item.idAwayTeam ?? "",
      name: item.strAwayTeam ?? "Unknown",
      shortName: null,
      crestUrl: item.strAwayTeamBadge ?? null,
    },
    homeScore: toNumberOrNull(item.intHomeScore),
    awayScore: toNumberOrNull(item.intAwayScore),
    // Not confirmed present in the free-tier event schema — see thesportsdb.ts's top comment.
    homeScoreHt: null,
    awayScoreHt: null,
    venueProviderId: null, // TheSportsDB does not expose a stable venue id on events.
    venueName: item.strVenue ?? null,
    retrievedAt: new Date().toISOString(),
  };
}
