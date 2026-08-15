import type { Database } from "@/lib/supabase/types";

export type FixtureStatus = Database["public"]["Enums"]["fixture_status"];

export const STATUS_LABEL: Record<FixtureStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  halftime: "HT",
  finished: "FT",
  postponed: "Postponed",
  cancelled: "Cancelled",
  abandoned: "Abandoned",
  unknown: "Unknown",
};

export function isLiveStatus(status: FixtureStatus): boolean {
  return status === "live" || status === "halftime";
}

/**
 * Kickoff-time formatting for a scheduled fixture. `includeWeekday` is off
 * by default (matches Matches/Live, which only ever list today's fixtures,
 * so a weekday would be redundant) — pass `true` for lists that can span
 * multiple days (e.g. a team's upcoming/recent fixtures), matching what
 * teams/[id] already showed before this was consolidated.
 */
export function formatKickoff(kickoffAt: string, options: { includeWeekday?: boolean } = {}): string {
  return new Date(kickoffAt).toLocaleString(undefined, {
    ...(options.includeWeekday ? { weekday: "short" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * `minuteElapsed` (fixtures.minute_elapsed, RECOMMENDATIONS.md item 57) only
 * ever overrides the label while the match is actually live — halftime,
 * finished, etc. keep their own fixed label since the provider doesn't keep
 * incrementing the clock once play has stopped, and a stale last-known
 * minute would be misleading rather than informative there.
 */
export function statusBadgeText(
  status: FixtureStatus,
  kickoffAt: string,
  options: { includeWeekday?: boolean; minuteElapsed?: number | null } = {},
): string {
  if (status === "scheduled") return formatKickoff(kickoffAt, options);
  if (status === "live" && options.minuteElapsed != null) return `${options.minuteElapsed}'`;
  return STATUS_LABEL[status];
}
