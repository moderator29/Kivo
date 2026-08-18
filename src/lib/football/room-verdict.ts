import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

/**
 * "What the room thought", extended with two more things that are also real
 * counts of real rows (KN-101).
 *
 * `MatchVerdictCard` already shows fan ratings and Room reaction totals. This
 * adds:
 *
 *   - **The busiest minute** — `posts.created_at` bucketed against
 *     `fixtures.kickoff_at`. A count of when people actually typed.
 *   - **The most-used reaction** — a group-by over the Room's real reactions.
 *
 * The item also suggests "the top-rated moment". That one is **not built, and
 * cannot be honestly**: `fan_ratings` rates the *fixture*, not a moment
 * (migration 0032 says so explicitly and explains why a per-player rating was
 * out of scope). There is no per-moment rating anywhere in this schema, so a
 * "top-rated moment" would have to be inferred from post volume and then
 * presented as a rating — which is exactly the sentiment-analysis-shaped
 * fabrication this item rules out in its own last line.
 *
 * Nothing here is sentiment analysis and nothing is an AI summary of opinion.
 * It is two counts.
 */

export type RoomVerdictExtras = {
  /**
   * Minutes after kickoff with the most Room posts, and how many. Null unless
   * the room was busy enough for "busiest" to mean anything — see the
   * thresholds below.
   */
  busiestMinute: { minute: number; postCount: number } | null;
  /** The Room's most-used reaction, and its count. Null when there is no clear leader. */
  topReaction: { type: Database["public"]["Enums"]["reaction_type"]; count: number } | null;
};

/**
 * Below this, "the busiest minute" is describing noise. Two posts a minute
 * apart have a "busiest minute" in the arithmetic sense and it means nothing —
 * presenting it as a peak would be inventing a story out of two data points.
 */
const MIN_POSTS_IN_BUSIEST_MINUTE = 3;
/** And a peak needs something to be a peak *against*. */
const MIN_DISTINCT_ACTIVE_MINUTES = 3;

export async function getRoomVerdictExtras(
  supabase: SupabaseClient<Database>,
  fixtureId: string,
  kickoffAt: string,
): Promise<RoomVerdictExtras> {
  const empty: RoomVerdictExtras = { busiestMinute: null, topReaction: null };

  try {
    const { data: postRows, error } = await supabase
      .from("posts")
      .select("id, created_at")
      .eq("fixture_id", fixtureId)
      // KIVO's own goal and red-card announcements land at exactly the
      // interesting minutes, so counting them would make the "busiest minute"
      // a measure of KIVO talking to itself rather than of people reacting.
      .eq("is_system", false)
      .limit(2000);

    if (error) {
      logError("football.roomVerdict.posts", error, { fixtureId });
      return empty;
    }

    const posts = postRows ?? [];
    if (posts.length === 0) return empty;

    const kickoffMs = new Date(kickoffAt).getTime();
    const byMinute = new Map<number, number>();
    for (const post of posts) {
      const minute = Math.floor((new Date(post.created_at).getTime() - kickoffMs) / 60_000);
      // Pre-kickoff build-up and long-after-the-whistle posts are real, but
      // they are not "a minute of the match" and would give a nonsensical
      // label ("busiest at minute -240").
      if (minute < 0 || minute > 130) continue;
      byMinute.set(minute, (byMinute.get(minute) ?? 0) + 1);
    }

    let busiestMinute: RoomVerdictExtras["busiestMinute"] = null;
    if (byMinute.size >= MIN_DISTINCT_ACTIVE_MINUTES) {
      const [minute, postCount] = [...byMinute.entries()].sort(
        // Ties break on the earlier minute, so the answer is stable rather than
        // depending on Map iteration order.
        (a, b) => b[1] - a[1] || a[0] - b[0],
      )[0];
      if (postCount >= MIN_POSTS_IN_BUSIEST_MINUTE) busiestMinute = { minute, postCount };
    }

    const { data: reactionRows, error: reactionError } = await supabase
      .from("reactions")
      .select("reaction_type")
      .eq("target_type", "post")
      .in(
        "target_id",
        posts.map((post) => post.id),
      )
      .limit(5000);

    if (reactionError) {
      logError("football.roomVerdict.reactions", reactionError, { fixtureId });
      return { busiestMinute, topReaction: null };
    }

    const byReaction = new Map<Database["public"]["Enums"]["reaction_type"], number>();
    for (const row of reactionRows ?? []) {
      byReaction.set(row.reaction_type, (byReaction.get(row.reaction_type) ?? 0) + 1);
    }

    let topReaction: RoomVerdictExtras["topReaction"] = null;
    if (byReaction.size > 0) {
      const sorted = [...byReaction.entries()].sort((a, b) => b[1] - a[1]);
      const [type, count] = sorted[0];
      // A tie is not a winner. Calling one of two equally-used reactions "the
      // most-used" would be picking, not counting.
      const isTied = sorted.length > 1 && sorted[1][1] === count;
      if (!isTied) topReaction = { type, count };
    }

    return { busiestMinute, topReaction };
  } catch (error) {
    logError("football.roomVerdict", error, { fixtureId });
    return empty;
  }
}
