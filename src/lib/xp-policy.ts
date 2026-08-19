import "server-only";
import { awardXp } from "@/lib/rewards";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * KIVO's XP policy, in one file, because an anti-farming control that lives in
 * four call sites is not a control — it is four chances to forget it.
 *
 * That is not hypothetical. `createPost` and `createPoll`
 * (src/app/(app)/social/actions.ts) have gated community XP behind a real
 * daily allowance since item 141. `createMotmPoll` and `createRefereePoll`
 * (src/app/(app)/matches/match-room-poll-actions.ts) shipped later, did the
 * same +2 award, and gated it behind nothing — because the rule was a pattern
 * to copy rather than a function to call. This module is the function.
 *
 * ---------------------------------------------------------------------------
 * THE RULE EVERY XP SOURCE HAS TO SATISFY
 * ---------------------------------------------------------------------------
 * XP is either:
 *
 *   (a) earned from an event KIVO independently verified — a prediction
 *       settled against a real synced result — in which case it needs no cap,
 *       because the user cannot manufacture the event; or
 *
 *   (b) earned from something the user does unilaterally — posting, starting a
 *       poll — in which case it MUST be both deduplicated by a stable identity
 *       and bounded by a real allowance, because otherwise the only limit on
 *       XP is how fast someone can click.
 *
 * There is no third category. An award that is neither verified nor capped is
 * the anti-farming hole, and closing it is the whole job here.
 */

/** XP for one piece of community content. Posts, polls and templated Room
 * polls are all worth the same: they are all "you said something". */
export const SOCIAL_POST_XP = 2;

/**
 * How many pieces of content earn XP in a rolling 24 hours.
 *
 * Item 141's reasoning, kept verbatim because it is still the reasoning: the
 * per-minute `create_post` limit throttles posting *speed*, not XP over a full
 * day — someone posting every couple of minutes all day would still farm
 * unlimited XP. This is a second, XP-specific window, keyed separately so it
 * never blocks the post itself. Past the cap, posting keeps working with no
 * XP attached.
 */
export const MAX_XP_POSTS_PER_DAY = 10;

/** The rate-limit action name. One string, so the four call sites cannot
 * accidentally consume four independent allowances. */
const SOCIAL_XP_ACTION = "create_post_xp";

/**
 * Awards XP for one piece of community content, if today's allowance has room.
 *
 * `postId` is required and is the real `posts.id`, which is what makes the
 * award idempotent: `xp_ledger`'s unique (profile_id, source_key) index means
 * a retried Server Action credits nothing twice.
 *
 * Requiring the post id is also the fix for a subtler hole than the missing
 * cap. `createRefereePoll` keyed its award on
 * `ref-poll:<fixture>:<decision>:<minute>` — a key built from the user's own
 * inputs, five decisions times a hundred and thirty-one minute values, so one
 * fixture offered six hundred and fifty-five distinct "already awarded?" keys
 * and every one of them was worth another 2 XP. A key must identify the thing
 * that happened, and the thing that happened is a post.
 *
 * Returns whether XP was actually awarded, so a caller can tell the user the
 * truth rather than assuming.
 */
export async function awardSocialPostXp(profileId: string, postId: string): Promise<boolean> {
  const allowance = await checkRateLimit(`user:${profileId}`, SOCIAL_XP_ACTION, MAX_XP_POSTS_PER_DAY, 60 * 60 * 24);
  if (!allowance.ok) return false;
  return awardXp(profileId, SOCIAL_POST_XP, SOCIAL_POST_XP_REASON, `post:${postId}`);
}

/** The ledger line these awards write. A constant because `/rewards` links a
 * ledger row to a surface, and a reason typed twice is a link that breaks on
 * one of them. */
export const SOCIAL_POST_XP_REASON = "Posted in the community";

/** The ledger line a settled prediction writes. Deliberately one stable
 * phrase for all six prediction types with the type appended after a
 * separator: the phrase is what `/rewards` matches on, and a reason string
 * that varies its opening words per type ("Correct winner prediction",
 * "Correct correct score prediction") both reads badly and silently breaks
 * that match. */
export function predictionXpReason(typeLabel: string): string {
  return `Correct prediction · ${typeLabel}`;
}
