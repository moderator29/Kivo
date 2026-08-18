/**
 * Grouping a feed's consecutive posts by the same author into one run.
 *
 * A fan watching a match posts four times in ten minutes. As four separate
 * cards that is four avatars, four names and four timestamps for one train of
 * thought, and it crowds out everyone else on the feed — which is the specific
 * way a small platform's feed starts feeling like one person shouting. As one
 * connected run it is what it actually is: an author's updates, in order.
 *
 * Two conditions, both deliberately strict:
 *
 * - **Same author, and the author must be identifiable.** Grouping on a
 *   display name would merge two different people who chose the same one, so
 *   this keys on `authorUsername`, which is unique. A post with no username
 *   resolved never joins a run.
 * - **Within `THREAD_MAX_GAP_MS` of the previous post.** Two posts from the
 *   same person a week apart are not one thought, and drawing a connector
 *   between them would claim a relationship the data does not support. Six
 *   hours is longer than a match and shorter than a day.
 *
 * System posts (`isSystem`) are excluded entirely. KIVO's automated goal and
 * red-card announcements are all authored by the same account, so grouping
 * them would collapse an entire Room's match events into one collapsed run —
 * the opposite of what they are for.
 *
 * Pure and separately testable on purpose: this is the one piece of the
 * threading behaviour that can be wrong in a way nobody sees in a screenshot.
 */

/** The minimum a feed item needs for this to group it. */
export type ThreadableItem = {
  id: string;
  createdAt: string;
  authorUsername?: string | null;
  isSystem?: boolean;
};

/** Six hours. Longer than any match plus its build-up and post-match; shorter
 * than "later that day", which is a different sitting. */
export const THREAD_MAX_GAP_MS = 6 * 60 * 60 * 1000;

export function groupPostsIntoThreads<T extends ThreadableItem>(posts: T[]): T[][] {
  const runs: T[][] = [];

  for (const post of posts) {
    const current = runs[runs.length - 1];
    const previous = current?.[current.length - 1];

    const joinsRun =
      previous !== undefined &&
      !post.isSystem &&
      !previous.isSystem &&
      Boolean(post.authorUsername) &&
      post.authorUsername === previous.authorUsername &&
      withinGap(previous.createdAt, post.createdAt);

    if (joinsRun) current.push(post);
    else runs.push([post]);
  }

  return runs;
}

/** Absolute difference, so a feed handed to this out of order (or with two
 * posts sharing a timestamp) still groups rather than silently splitting. */
function withinGap(a: string, b: string): boolean {
  const first = Date.parse(a);
  const second = Date.parse(b);
  if (Number.isNaN(first) || Number.isNaN(second)) return false;
  return Math.abs(second - first) <= THREAD_MAX_GAP_MS;
}
