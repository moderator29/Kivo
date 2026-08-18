import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Everything KIVO can honestly say about one person's season, built entirely
 * from that person's own rows (KN-98).
 *
 * The design constraint that makes this feature possible at all: every number
 * here is owner-scoped. There is no aggregate over other users anywhere, so
 * there is no minimum-sample problem, no leaderboard position to suppress, and
 * nothing that becomes misleading on a platform with few users. "You have made
 * three predictions and got two right" is exactly as true with four accounts on
 * the platform as with four million.
 *
 * Every query runs through the caller's own session, so RLS is what scopes it —
 * `predictions_select_own`, `xp_ledger_select_own`, `user_badges_select_own`
 * and the rest were already the boundary, and this adds no way around them.
 *
 * A count that could not be read comes back as null and the UI omits that
 * piece, rather than showing zero. Zero is a claim ("you have written no
 * posts"), and a failed count is not entitled to make it.
 */

export type SeasonPrediction = {
  /** Every prediction they have made, settled or not. */
  total: number;
  /** Predictions that have actually been scored — the only ones an accuracy can be built from. */
  settled: number;
  correct: number;
  /**
   * Null until `MIN_SETTLED_FOR_ACCURACY` predictions have been scored. The
   * fraction ("2 of 3") is always shown; the *percentage* is not, because a
   * single correct call rendering as "100%" reads as a claim about skill that
   * one result cannot support. This is a presentation judgement about their own
   * real data, not a suppression of it — the raw numbers are always right there.
   */
  accuracyPct: number | null;
};

export type SeasonGameweek = {
  gameweekNumber: number;
  points: number;
  teamName: string;
};

export type SeasonSummary = {
  memberSince: string | null;
  predictions: SeasonPrediction | null;
  currentStreak: number | null;
  longestStreak: number | null;
  totalXp: number | null;
  badges: { name: string; awardedAt: string; iconUrl: string | null }[] | null;
  posts: number | null;
  comments: number | null;
  follows: { teams: number; players: number; competitions: number; people: number } | null;
  /** Per-gameweek fantasy arc, oldest first, across every squad they own. */
  fantasyArc: SeasonGameweek[] | null;
  fantasyTotal: number | null;
  /** True when literally nothing has happened yet — the page says so plainly. */
  isEmpty: boolean;
};

export const MIN_SETTLED_FOR_ACCURACY = 5;

export async function getSeasonSummary(profileId: string, memberSince: string | null): Promise<SeasonSummary> {
  const supabase = createServerSupabaseClient();

  const [
    predictionRows,
    streak,
    xp,
    badgeRows,
    postCount,
    commentCount,
    followRows,
    fantasyRows,
  ] = await Promise.all([
    // `points_awarded` is null until the scoring pass has run, which is exactly
    // what separates "settled" from "made" — never inferred from the fixture's
    // status, because a finished fixture whose predictions have not been scored
    // yet is a real state this platform has.
    supabase.from("predictions").select("points_awarded").eq("profile_id", profileId),
    supabase.rpc("get_activity_streak", { p_profile_id: profileId }),
    supabase.rpc("get_xp_total", { p_profile_id: profileId }),
    supabase
      .from("user_badges")
      .select("awarded_at, badge:badges(name, icon_url)")
      .eq("profile_id", profileId)
      .order("awarded_at", { ascending: false }),
    supabase.from("posts").select("id", { count: "exact", head: true }).eq("author_profile_id", profileId),
    supabase.from("comments").select("id", { count: "exact", head: true }).eq("author_profile_id", profileId),
    supabase.from("follows").select("followed_type").eq("follower_profile_id", profileId),
    supabase
      .from("fantasy_points")
      .select("points, fantasy_team:fantasy_teams!inner(name, owner_profile_id), gameweek:fantasy_gameweeks(number)")
      .eq("fantasy_team.owner_profile_id", profileId),
  ]);

  const predictions: SeasonPrediction | null = predictionRows.error
    ? null
    : (() => {
        const rows = predictionRows.data ?? [];
        const settledRows = rows.filter((row) => row.points_awarded !== null);
        const correct = settledRows.filter((row) => (row.points_awarded ?? 0) > 0).length;
        return {
          total: rows.length,
          settled: settledRows.length,
          correct,
          accuracyPct:
            settledRows.length >= MIN_SETTLED_FOR_ACCURACY
              ? Math.round((correct / settledRows.length) * 100)
              : null,
        };
      })();

  const streakRow = Array.isArray(streak.data) ? streak.data[0] : streak.data;

  const follows = followRows.error
    ? null
    : (followRows.data ?? []).reduce(
        (acc, row) => {
          if (row.followed_type === "team") acc.teams += 1;
          else if (row.followed_type === "player") acc.players += 1;
          else if (row.followed_type === "competition") acc.competitions += 1;
          else if (row.followed_type === "user") acc.people += 1;
          return acc;
        },
        { teams: 0, players: 0, competitions: 0, people: 0 },
      );

  const fantasyArc: SeasonGameweek[] | null = fantasyRows.error
    ? null
    : (fantasyRows.data ?? [])
        // A points row whose gameweek could not be resolved has no place on a
        // per-gameweek arc — dropped rather than plotted at an invented index.
        .flatMap((row) => {
          const number = row.gameweek?.number;
          if (typeof number !== "number") return [];
          return [{ gameweekNumber: number, points: row.points, teamName: row.fantasy_team?.name ?? "Your squad" }];
        })
        .sort((a, b) => a.gameweekNumber - b.gameweekNumber);

  const badges = badgeRows.error
    ? null
    : (badgeRows.data ?? []).flatMap((row) =>
        row.badge ? [{ name: row.badge.name, awardedAt: row.awarded_at, iconUrl: row.badge.icon_url }] : [],
      );

  const posts = postCount.error ? null : (postCount.count ?? 0);
  const comments = commentCount.error ? null : (commentCount.count ?? 0);
  const fantasyTotal = fantasyArc === null ? null : fantasyArc.reduce((sum, gw) => sum + gw.points, 0);

  const isEmpty =
    (predictions?.total ?? 0) === 0 &&
    (posts ?? 0) === 0 &&
    (comments ?? 0) === 0 &&
    (badges?.length ?? 0) === 0 &&
    (fantasyArc?.length ?? 0) === 0 &&
    (xp.data ?? 0) === 0;

  return {
    memberSince,
    predictions,
    currentStreak: streakRow?.current_streak ?? null,
    longestStreak: streakRow?.longest_streak ?? null,
    totalXp: xp.error ? null : (xp.data ?? 0),
    badges,
    posts,
    comments,
    follows,
    fantasyArc,
    fantasyTotal,
    isEmpty,
  };
}
