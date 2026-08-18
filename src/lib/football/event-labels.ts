import type { Database } from "@/lib/supabase/types";

export type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];

export const EVENT_LABEL: Record<FixtureEventType, string> = {
  goal: "Goal",
  own_goal: "Own goal",
  penalty_goal: "Penalty scored",
  penalty_missed: "Penalty missed",
  yellow_card: "Yellow card",
  second_yellow_card: "Second yellow",
  red_card: "Red card",
  substitution: "Substitution",
  var_review: "VAR review",
};

/**
 * Shared classification, single source of truth for "which real events are
 * big enough to notify/announce broadly" — used by both
 * match-notifications.ts's notifyFixtureEvent (team-wide audience) and
 * match-room-system-posts.ts's insertSystemEventPost (RECOMMENDATIONS.md
 * item 254). Deliberately excludes own_goal: notifyFixtureEvent already
 * treats an own goal as bad news for the team it's credited against rather
 * than a celebratory team-wide event (it only notifies the player's own
 * followers, not the team's whole audience) — a system Room post follows the
 * same distinction rather than inventing a different rule.
 */
export function isGoalEventType(eventType: FixtureEventType): boolean {
  return eventType === "goal" || eventType === "penalty_goal";
}

export function isRedCardEventType(eventType: FixtureEventType): boolean {
  return eventType === "red_card" || eventType === "second_yellow_card";
}
