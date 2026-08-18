import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export type MatchRoomActivity = {
  /** Real human posts in this fixture's Room — KIVO's own system-authored
   * goal/red-card posts (migration 0047) are excluded by the RPC. */
  postCount: number;
  /** Distinct human authors. This is the number worth showing: "8 people are
   * talking" is a fact about people, "40 posts" can be one person. */
  participantCount: number;
};

/**
 * Batched Match Room activity for a list of fixtures (KN-41).
 *
 * `posts.fixture_id` is the foreign key the entire Room feature runs on, and
 * until this existed no list surface read it — so a fixture with a live
 * argument going on in its Room was visually identical to one nobody had ever
 * opened. One round trip for every fixture on screen, via
 * `get_match_room_activity` (migration 0057).
 *
 * Two rules the callers must keep, because they are what separate this from
 * fabricated engagement metrics:
 *
 * 1. **Zero renders as nothing.** No "be the first to post", no floor, no
 *    rounding up. A fixture with an empty Room looks exactly as it does today.
 * 2. **The number is the number.** It is a real count of real rows by real
 *    people, filtered by the same RLS every other surface obeys.
 *
 * Returns an empty map on failure rather than throwing: a Room count is a
 * garnish on a fixture list, and it must never be the reason /matches or /live
 * fails to render.
 */
export async function getMatchRoomActivity(
  supabase: SupabaseClient<Database>,
  fixtureIds: string[],
): Promise<Map<string, MatchRoomActivity>> {
  const activity = new Map<string, MatchRoomActivity>();
  if (fixtureIds.length === 0) return activity;

  const { data, error } = await supabase.rpc("get_match_room_activity", { p_fixture_ids: fixtureIds });
  if (error) {
    console.error("Failed to load match room activity", error);
    return activity;
  }

  for (const row of data ?? []) {
    activity.set(row.fixture_id, {
      postCount: Number(row.post_count),
      participantCount: Number(row.participant_count),
    });
  }
  return activity;
}

/** The one place the Room count is turned into words, so /matches, /live and
 * every future list phrase it identically. Null when there is nothing real to
 * say — callers render nothing at all rather than a zero. */
export function roomActivityLabel(activity: MatchRoomActivity | undefined): string | null {
  if (!activity || activity.participantCount === 0) return null;
  if (activity.participantCount === 1) return "1 person in the Room";
  return `${activity.participantCount} people in the Room`;
}
