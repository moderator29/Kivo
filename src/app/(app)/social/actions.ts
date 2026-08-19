"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge, evaluateBadgeCriteria, hasBadge } from "@/lib/rewards";
import { awardSocialPostXp } from "@/lib/xp-policy";
import { checkRateLimit } from "@/lib/rate-limit";
import { isReactionType, type ReactionType } from "@/lib/reactions";
import { shouldNotify, withQuietHours } from "@/lib/notification-preferences";
import { blockExistsBetween } from "@/lib/blocks";
import { fetchPostsPage, type PostListItem } from "./posts";
import { resolveFeedScope, type SocialFilter } from "@/lib/social-filters";
import { buildNotification } from "@/lib/notification-payloads";
import { logError } from "@/lib/log";

const MAX_POST_LENGTH = 2000;

// Item 141's daily XP allowance now lives in src/lib/xp-policy.ts, with the
// award itself, because two later call sites (the templated Room polls) did
// the same +2 award and skipped the cap entirely — a rule that has to be
// remembered is not a rule. See awardSocialPostXp.

// RECOMMENDATIONS.md item 172: mirrors poll_options' own DB constraints
// (poll_options_position_range 0-3, poll_options_label_length 1-80) so a
// bad submission is caught here with a real error message instead of
// surfacing as a raw Postgres constraint violation.
const MIN_POLL_OPTIONS = 2;
const MAX_POLL_OPTIONS = 4;
const MAX_POLL_OPTION_LENGTH = 80;

const TEN_POSTS_THRESHOLD = 10;

/**
 * KIVO_NEXT_GEN KN-19: awarding the `ten_posts` badge used to run a full
 * `count: "exact"` over the author's entire `posts` history on every single
 * submission — an O(total posts) aggregate answering a question that can never
 * change again once the answer is yes, feeding a badge write that is already
 * idempotent. The most prolific users paid the most for it, every time, forever.
 *
 * Two bounded lookups instead. The badge check short-circuits the common case
 * (anyone past ten posts, which is everyone the old count was most expensive
 * for). Below that, ten post ids are fetched rather than counted: PostgREST's
 * `count=exact` runs its own aggregate over the whole filtered set and ignores
 * `limit`, so capping the count was not actually available — capping the rows
 * is.
 *
 * `awardBadge` stays idempotent and is still called unconditionally when the
 * threshold is met; this only decides whether to bother asking.
 */
async function maybeAwardTenPostsBadge(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  profileId: string,
): Promise<void> {
  if (await hasBadge(profileId, "ten_posts")) return;

  const { data: posts } = await supabase
    .from("posts")
    .select("id")
    .eq("author_profile_id", profileId)
    .limit(TEN_POSTS_THRESHOLD);

  if ((posts?.length ?? 0) >= TEN_POSTS_THRESHOLD) {
    await awardBadge(profileId, "ten_posts");
  }
}

export async function createPost(formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body || body.length > MAX_POST_LENGTH) {
    return { error: "Post must be between 1 and 2000 characters." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to post." };
  }

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "create_post", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  // Optional match-room scoping: PostComposer includes this as a hidden field
  // when it's rendered inside Match Centre's Room tab (see MatchRoomTab). Left
  // unset, the insert lands as a normal, unscoped community post.
  const fixtureId = String(formData.get("fixture_id") ?? "").trim() || null;

  const supabase = createServerSupabaseClient();
  // The id comes back because KN-91's XP award is keyed on it below — the post
  // is the identity of the award, so a retried submission cannot pay twice.
  // `posts` is publicly selectable (migration 0001), so reading it back here
  // needs no policy change.
  const { data: created, error } = await supabase
    .from("posts")
    .insert({ author_profile_id: profile.id, body, fixture_id: fixtureId })
    .select("id")
    .single();

  if (error || !created) {
    logError("social.createPost", error);
    return { error: "Couldn't publish your post. Try again." };
  }

  // awardBadge is a harmless no-op on repeat posts (unique constraint on
  // user_badges swallows the duplicate) — no need to check "is this their first."
  // Item 141: XP itself is capped separately from the post succeeding — a
  // user past today's XP cap keeps posting normally, they just stop earning
  // XP for it until the 24h window rolls over.
  await Promise.all([awardSocialPostXp(profile.id, created.id), awardBadge(profile.id, "first_post")]);

  await maybeAwardTenPostsBadge(supabase, profile.id);
  // KIVO_NEXT_GEN KN-92: every badge whose condition is a countable fact is now
  // described in `badges.criteria` rather than in code, so this one call covers
  // the whole data-driven half of the catalogue — and a badge added tomorrow
  // over an existing fact needs no deploy at all.
  await evaluateBadgeCriteria(profile.id);

  revalidatePath("/social");
  if (fixtureId) revalidatePath(`/matches/${fixtureId}`);
  return { error: null };
}

/**
 * RECOMMENDATIONS.md item 172: creates a post whose body is the poll
 * question, plus 2-4 poll_options rows. Two inserts, not one atomic RPC —
 * poll_options_insert_own_post's WITH CHECK already requires the options to
 * belong to a post this same caller just authored, so there's no window for
 * someone else's post to end up with forged options; a failure on the second
 * insert best-effort deletes the just-created post rather than leaving an
 * orphan post with no options rendering as a broken poll.
 */
export async function createPoll(formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body || body.length > MAX_POST_LENGTH) {
    return { error: "Poll question must be between 1 and 2000 characters." };
  }

  const options = Array.from({ length: MAX_POLL_OPTIONS }, (_, i) => String(formData.get(`option_${i}`) ?? "").trim()).filter(
    (option) => option.length > 0,
  );

  if (options.length < MIN_POLL_OPTIONS) {
    return { error: `A poll needs at least ${MIN_POLL_OPTIONS} options.` };
  }
  if (options.some((option) => option.length > MAX_POLL_OPTION_LENGTH)) {
    return { error: `Each option must be ${MAX_POLL_OPTION_LENGTH} characters or fewer.` };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to post." };
  }

  // Same bucket as createPost — a poll is still one post from the rate
  // limiter's point of view.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "create_post", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  // KN-29. `createPost` has always read this hidden field — `PostComposer`
  // submits it whenever it is rendered inside a Match Centre Room — and
  // `createPoll`, in the same file, never did. The consequence is not cosmetic:
  // the founding brief names polls by example as "score/MOTM/ref decisions",
  // and all three of those are inherently about one match. Without a
  // fixture_id a poll cannot appear in the Room for the match it is about, so
  // the one poll type the brief actually specifies was unbuildable through the
  // UI. One line, and it is the same line createPost uses.
  const fixtureId = String(formData.get("fixture_id") ?? "").trim() || null;

  const supabase = createServerSupabaseClient();
  const { data: post, error: postError } = await supabase
    .from("posts")
    .insert({ author_profile_id: profile.id, body, fixture_id: fixtureId })
    .select("id")
    .single();

  if (postError || !post) {
    logError("social.createPollPost", postError);
    return { error: "Couldn't publish your poll. Try again." };
  }

  const { error: optionsError } = await supabase
    .from("poll_options")
    .insert(options.map((label, position) => ({ post_id: post.id, position, label })));

  if (optionsError) {
    logError("social.createPollOptions", optionsError);
    await supabase.from("posts").delete().eq("id", post.id);
    return { error: "Couldn't publish your poll. Try again." };
  }

  // KN-91: same key shape as createPost above — a poll is a post.
  await Promise.all([awardSocialPostXp(profile.id, post.id), awardBadge(profile.id, "first_post")]);

  await maybeAwardTenPostsBadge(supabase, profile.id);
  // KIVO_NEXT_GEN KN-92: every badge whose condition is a countable fact is now
  // described in `badges.criteria` rather than in code, so this one call covers
  // the whole data-driven half of the catalogue — and a badge added tomorrow
  // over an existing fact needs no deploy at all.
  await evaluateBadgeCriteria(profile.id);

  revalidatePath("/social");
  // KN-29: a Room-scoped poll has to invalidate the Room it was posted into,
  // exactly as createPost already does for a Room-scoped post.
  if (fixtureId) revalidatePath(`/matches/${fixtureId}`);
  return { error: null };
}

/**
 * Records (or changes) the caller's vote on a poll post.
 *
 * KN-23. `poll_votes_unique_per_user` means only one row per (post, profile)
 * can exist, so changing a vote is unavoidably delete-then-insert. Done from
 * here that was two round trips with nothing spanning them: a failure in the
 * gap left the user with NO vote where they had one a moment earlier, while
 * the error said "Couldn't record your vote" — which reads as "nothing
 * changed". Both statements now happen inside `vote_on_poll` (migration 0066),
 * so they commit together or not at all.
 *
 * The RPC is SECURITY INVOKER, not SECURITY DEFINER: RLS is still the thing
 * deciding whether this caller may write, including 0045's moderation gate.
 * See the migration for why that mattered more than the atomicity itself.
 */
export async function voteOnPoll(postId: string, optionId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to vote." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "vote_on_poll", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.rpc("vote_on_poll", { p_post_id: postId, p_option_id: optionId });

  if (error) {
    // P0002 is the RPC's own "that option isn't on this poll" — a real,
    // explainable state (the poll was edited or deleted under them), not an
    // infrastructure failure, so it gets its own message rather than the
    // generic one.
    if (error.code === "P0002") return { error: "That poll option no longer exists." };
    logError("social.recordPollVote", error);
    return { error: "Couldn't record your vote. Try again." };
  }

  revalidatePath("/social");
  return { error: null };
}

/**
 * Sets (or clears) the caller's reaction on a post or comment. Reactions are
 * single-choice per user per target — `reactions_unique_per_target` in
 * supabase/migrations/0001_kivo_core_schema.sql documents "changing reaction
 * = delete + insert, not an update-in-place" — so this always clears any
 * existing row first, then inserts the new one unless `reactionType` is null
 * (the caller tapped their active reaction again to remove it).
 */
export async function setReaction(targetType: "post" | "comment", targetId: string, reactionType: ReactionType | null) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to react." };

  if (reactionType !== null && !isReactionType(reactionType)) {
    return { error: "Invalid reaction." };
  }

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "set_reaction", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();

  // KN-23, same shape as voteOnPoll above: the clear-then-set pair is one
  // statement now (migration 0066), so a failure between them can no longer
  // leave the user with no reaction at all after they asked to change one.
  const { error } = await supabase.rpc("set_reaction", {
    p_target_type: targetType,
    p_target_id: targetId,
    // Cast, and here is why it is not papering over anything: a plpgsql
    // argument is nullable and `set_reaction` handles null explicitly (it means
    // "clear my reaction" — the caller tapped their active one again). Supabase's
    // type generator has no way to express SQL argument nullability, so it emits
    // every Args field as non-null. The null is the documented contract, not a
    // type hole.
    p_reaction_type: reactionType as ReactionType,
  });

  if (error) {
    logError("social.setReaction", error);
    return { error: "Couldn't update your reaction." };
  }

  if (reactionType !== null && targetType === "post") {
    await notifyPostLiked(targetId, profile);
  }

  revalidatePath("/social");
  return { error: null };
}

/** Appends the next page of `/social` posts, offset-based to match the
 * `loadMoreLeagues` / `loadMoreTeams` pattern (see components/leagues/leagues-list.tsx).
 * The filter (RECOMMENDATIONS item 175, extended for Club mates and Rivals) threads through to fetchPostsPage
 * so "Load more" keeps respecting whichever tab the viewer had selected. */
export async function loadMorePosts(
  offset: number,
  options?: {
    filter?: SocialFilter;
    /**
     * KIVO_NEXT_GEN KN-94. When present, paging is keyset rather than offset:
     * "give me the posts strictly older than this exact row". A post written
     * between two page requests then cannot shift the window and make the
     * reader miss one — which offset paging does silently, and which deduping
     * the resulting duplicate client-side hides rather than fixes.
     *
     * Safe to accept from the client: it is only ever a position in an ordering
     * the server itself controls, and every row it can reach is one the same
     * RLS policies would have returned anyway.
     */
    cursor?: { createdAt: string; id: string };
  },
): Promise<{
  error: string | null;
  posts: PostListItem[];
  hasMore: boolean;
  nextCursor: { createdAt: string; id: string } | null;
}> {
  const profile = await getOrCreateProfile();
  // The scope is re-derived from the viewer's own profile on every call rather
  // than passed in from the client: a filter name is safe to accept from a
  // URL, a team id is not — accepting one would let anyone page through any
  // club's fan feed by editing a request.
  const scope = resolveFeedScope(options?.filter ?? "all", profile);
  if (scope.kind === "unavailable") return { error: null, posts: [], hasMore: false, nextCursor: null };
  return fetchPostsPage(offset, profile?.id ?? null, {
    followingOnly: scope.kind === "following",
    teamId: scope.kind === "team" ? scope.teamId : undefined,
    cursor: options?.cursor,
  });
}

/**
 * notifications has no client-facing insert policy by design (system-generated
 * only) — this is the system doing the generating, so it goes through the
 * service-role client deliberately, not as an RLS workaround.
 */
async function notifyPostLiked(postId: string, liker: { id: string; username: string; display_name: string | null }) {
  const supabase = createServerSupabaseClient();
  const { data: post } = await supabase
    .from("posts")
    .select("author_profile_id, fixture_id")
    .eq("id", postId)
    .maybeSingle();

  if (!post || post.author_profile_id === liker.id) return;

  const serviceClient = createServiceRoleSupabaseClient();

  // RECOMMENDATIONS.md item 285: gate before writing, not after — a
  // recipient who has social_alerts_enabled (or in_app_enabled) off should
  // never get the row in the first place.
  if (!(await shouldNotify(serviceClient, post.author_profile_id, "social_alerts_enabled"))) return;

  // Migration 0086: a block silences the bell as well as the feed. Checked in
  // both directions — either party having blocked the other is reason enough
  // not to write the row — and before the write rather than filtering at read
  // time, because a notification that was never produced cannot leak that a
  // block exists.
  if (await blockExistsBetween(serviceClient, post.author_profile_id, liker.id)) return;

  // KN-21. Reactions are delete-then-insert, so *changing* one re-notifies, and
  // toggling off and on re-notifies. With a 30-per-60s limit on set_reaction,
  // one person could put thirty rows in one author's bell inside a minute — from
  // a single post — just by tapping. The founding brief names "deduplicated" as
  // a required property of the notification system; this is the reachable-today
  // instance of it missing.
  //
  // Scoped to UNREAD rows deliberately. Once the author has read the last
  // notification about this post, a later reaction from the same person is
  // genuinely new information and should surface again; suppressing it forever
  // would be a different bug. So the rule is "don't stack unread duplicates",
  // not "notify once, ever".
  //
  // Filtered on the payload's own fields rather than on a new column, because
  // the pairing that defines a duplicate — (post, liker) — is already in there
  // and `notifications_payload_shape` (migration 0061) guarantees its shape.
  const { data: existing, error: existingError } = await serviceClient
    .from("notifications")
    .select("id")
    .eq("profile_id", post.author_profile_id)
    .eq("type", "post_like")
    .is("read_at", null)
    .eq("payload->>post_id", postId)
    .eq("payload->>liker_username", liker.username)
    .limit(1)
    .maybeSingle();

  // Fails OPEN: if we cannot tell whether a duplicate exists, sending one extra
  // notification is a much smaller harm than silently dropping the only one an
  // author was going to get.
  if (existingError) {
    logError("social.checkDuplicateLikeNotification", existingError);
  } else if (existing) {
    return;
  }

  // KN-90: the typed constructor, not an object literal — a dropped or renamed
  // field is now a type error here rather than a notification that renders
  // normally and whose link goes nowhere.
  //
  // fixture_id (nullable) lets the bell/notifications page route back to the
  // fixture's Match Centre Room tab for a room post, vs. /social for a
  // general one — see notificationHref() in lib/notification-registry.ts.
  // Migration 0088: written either way, but held back from the unread badge
  // until this author's quiet window ends. A like is the lowest-priority thing
  // KIVO produces — if anything should wait until morning, it is this.
  const { error } = await serviceClient.from("notifications").insert(
    await withQuietHours(
      serviceClient,
      buildNotification(post.author_profile_id, "post_like", {
        post_id: postId,
        fixture_id: post.fixture_id,
        liker_username: liker.username,
        liker_display_name: liker.display_name,
      }),
      "social_alerts_enabled",
    ),
  );

  if (error) logError("social.createLikeNotification", error);
}
