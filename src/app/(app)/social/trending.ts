import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import {
  trendingVerdict,
  trendingWindowStart,
  type FanSentiment,
  type TrendingRoomRow,
  type TrendingVerdict,
} from "@/lib/trending";

/**
 * The read side of trending. Three RPCs (migration 0089), one round trip each,
 * and no post-processing beyond turning snake_case into camelCase — every
 * number the panel renders is the number the database returned.
 *
 * The ranking is deliberately platform-level and the *display* is
 * viewer-level: `get_trending_match_rooms` counts everything real (minus
 * shadow-muted authors, which is KIVO's own moderation state rather than one
 * reader's opinion), and the fixtures it names are then read back through RLS.
 * A viewer's personal blocks (0086) therefore do not distort the count and do
 * still hide what they should. See the migration for the full reasoning.
 */

export type TrendingRoom = TrendingRoomRow & {
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: string;
  status: string;
  sentiment: FanSentiment;
};

export type TrendingResult = {
  verdict: TrendingVerdict<TrendingRoom>;
  /** The window's start, so the panel can state what it measured rather than
   * asserting "trending" with no period attached. */
  since: string;
  /** True when the RPC itself failed. Distinct from an empty window: one means
   * "nothing happened", the other means "KIVO could not tell", and rendering
   * them identically is the bug docs/BUG_AUDIT_2026-08-18.md S5 describes for
   * poll results. */
  unavailable: boolean;
};

const EMPTY_SENTIMENT = (fixtureId: string): FanSentiment => ({
  fixtureId,
  ratingCount: 0,
  avgRating: null,
  pollCount: 0,
  pollVoteCount: 0,
});

export async function fetchTrendingRooms(limit = 5, now: Date = new Date()): Promise<TrendingResult> {
  const since = trendingWindowStart(now);
  const supabase = createServerSupabaseClient();

  const { data: rows, error } = await supabase.rpc("get_trending_match_rooms", {
    p_since: since.toISOString(),
    p_limit: limit,
  });

  if (error) {
    logError("social.trending.fetchTrendingRooms", error);
    return { verdict: { kind: "empty" }, since: since.toISOString(), unavailable: true };
  }

  const counts = rows ?? [];
  if (counts.length === 0) {
    return { verdict: { kind: "empty" }, since: since.toISOString(), unavailable: false };
  }

  const fixtureIds = counts.map((row) => row.fixture_id);

  // Fixtures come back through RLS like any other read. Sentiment is one
  // batched call for the whole list rather than one per room, matching
  // get_prediction_consensus's shape.
  const [{ data: fixtures }, { data: sentimentRows }] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status,
         home_team:teams!fixtures_home_team_id_fkey(name, short_name),
         away_team:teams!fixtures_away_team_id_fkey(name, short_name)`,
      )
      .in("id", fixtureIds),
    supabase.rpc("get_fan_sentiment", { p_fixture_ids: fixtureIds }),
  ]);

  const fixtureById = new Map((fixtures ?? []).map((fixture) => [fixture.id, fixture]));
  const sentimentByFixture = new Map(
    (sentimentRows ?? []).map((row) => [
      row.fixture_id,
      {
        fixtureId: row.fixture_id,
        ratingCount: row.rating_count,
        avgRating: row.avg_rating,
        pollCount: row.poll_count,
        pollVoteCount: row.poll_vote_count,
      } satisfies FanSentiment,
    ]),
  );

  const enriched: TrendingRoom[] = counts.flatMap((row) => {
    const fixture = fixtureById.get(row.fixture_id);
    // A fixture the viewer cannot read, or one deleted between the two
    // queries, is dropped rather than rendered as "Unknown vs Unknown".
    if (!fixture?.home_team?.name || !fixture.away_team?.name) return [];
    return [
      {
        fixtureId: row.fixture_id,
        postCount: row.post_count,
        commentCount: row.comment_count,
        participantCount: row.participant_count,
        homeTeamName: fixture.home_team.short_name || fixture.home_team.name,
        awayTeamName: fixture.away_team.short_name || fixture.away_team.name,
        kickoffAt: fixture.kickoff_at,
        status: fixture.status,
        sentiment: sentimentByFixture.get(row.fixture_id) ?? EMPTY_SENTIMENT(row.fixture_id),
      },
    ];
  });

  return {
    verdict: trendingVerdict(enriched),
    since: since.toISOString(),
    unavailable: false,
  };
}
