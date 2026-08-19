/**
 * Trending, with the one rule that makes it worth having.
 *
 * "Trending" is the single easiest place in a social product to invent a
 * signal, and an invented one is worth less than nothing — it teaches people
 * that KIVO's numbers are decoration. So everything here is a count of rows a
 * real person created, inside a window this module states out loud, and there
 * is deliberately no score: no decay curve, no velocity, no weighting of a
 * reaction against a comment. A reader can check a count and a window. Nobody
 * can check a trend score.
 *
 * The rule KIVO already applied elsewhere and this file inherits: `/search`
 * and the command palette say "Popular", never "Trending", because a follower
 * total is not time-windowed (see search-actions.ts). These figures are
 * windowed off real `created_at` columns, which is what earns the word.
 *
 * The second rule is the one this module mostly exists for: **a window with
 * too little in it is not a ranking**. Three posts from one person is not a
 * trend, it is a Tuesday. Below a real participant threshold this says so,
 * with the real numbers, rather than ranking noise into a leaderboard.
 */

/** The window every figure on the panel is measured over. Stated in the UI,
 * because a "trending" number without a window is not a claim about anything. */
export const TRENDING_WINDOW_HOURS = 24;

/**
 * How many distinct people have to be involved before a list of counts is
 * allowed to be presented as a ranking.
 *
 * Three, matching the minimum-sample convention PredictionCard's consensus bar
 * and FanRatingCard already use — reused rather than reinvented so KIVO has
 * one answer to "how little is too little", not four.
 *
 * Distinct participants, not total activity, on purpose: one person posting
 * forty times is the exact case a raw volume threshold waves through and a
 * reader would immediately recognise as not a trend.
 */
export const MIN_TRENDING_PARTICIPANTS = 3;

export function trendingWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - TRENDING_WINDOW_HOURS * 60 * 60_000);
}

export type TrendingRoomRow = {
  fixtureId: string;
  postCount: number;
  commentCount: number;
  participantCount: number;
};

export type TrendingPostRow = {
  postId: string;
  commentCount: number;
  reactionCount: number;
  participantCount: number;
};

type Countable = { participantCount: number };

/**
 * What a window is actually allowed to say.
 *
 * Three outcomes, and the middle one is the point of the whole module:
 *
 *   empty     nothing happened in the window. An honest empty state.
 *   too-quiet something happened, but not enough of it, from not enough
 *            people, to call it a trend. The real totals come back with it so
 *            the UI can say "9 posts from 2 people in the last 24 hours" —
 *            which is more useful and more honest than either a fake ranking
 *            or a blank panel that implies nothing happened.
 *   ranked    a real ranking over real counts.
 */
export type TrendingVerdict<T> =
  | { kind: "empty" }
  | { kind: "too-quiet"; participants: number; items: number }
  | { kind: "ranked"; rows: T[] };

export function trendingVerdict<T extends Countable>(rows: T[]): TrendingVerdict<T> {
  if (rows.length === 0) return { kind: "empty" };

  // The best-supported single entry decides. Summing participants across rows
  // would count one person twice for talking in two rooms, and would let a
  // dozen one-person rooms add up to a "trend" none of them is.
  const bestParticipants = Math.max(...rows.map((row) => row.participantCount));
  if (bestParticipants < MIN_TRENDING_PARTICIPANTS) {
    return {
      kind: "too-quiet",
      participants: bestParticipants,
      items: rows.length,
    };
  }

  // Only the entries that clear the bar are shown. A ranking whose third place
  // is one person talking to themselves undermines the two above it.
  return { kind: "ranked", rows: rows.filter((row) => row.participantCount >= MIN_TRENDING_PARTICIPANTS) };
}

/* ---------------------------------------------------------------------------
   FAN SENTIMENT
--------------------------------------------------------------------------- */

/**
 * Below this many real ratings, an average is not a sentiment — it is one
 * person's mood. Same threshold and same reasoning as everything above.
 */
export const MIN_SENTIMENT_RATINGS = 3;

export type FanSentiment = {
  fixtureId: string;
  ratingCount: number;
  /** Null when nobody has rated. Never coerced to 0, which would read as
   * "everybody hated it" rather than "nobody has said". */
  avgRating: number | null;
  pollCount: number;
  pollVoteCount: number;
};

export type SentimentReading =
  | { kind: "none" }
  | { kind: "too-few"; ratingCount: number }
  | { kind: "real"; avgRating: number; ratingCount: number };

/**
 * How much a fan rating average is allowed to be presented as.
 *
 * Returns a number and a count and never a word. "Positive", "mixed" and
 * "poor" are boundaries somebody chose, and putting them here would hide that
 * choice inside a function; 3.8 out of 5 from 41 people is a fact the reader
 * can interpret themselves, which is the whole difference between a rating and
 * a verdict.
 */
export function sentimentReading(sentiment: FanSentiment): SentimentReading {
  if (sentiment.ratingCount === 0 || sentiment.avgRating === null) return { kind: "none" };
  if (sentiment.ratingCount < MIN_SENTIMENT_RATINGS) {
    return { kind: "too-few", ratingCount: sentiment.ratingCount };
  }
  return { kind: "real", avgRating: sentiment.avgRating, ratingCount: sentiment.ratingCount };
}
