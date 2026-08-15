import type { Database } from "@/lib/supabase/types";

type FixtureEventType = Database["public"]["Enums"]["fixture_event_type"];

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
