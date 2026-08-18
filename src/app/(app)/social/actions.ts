"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge, awardXp, hasBadge } from "@/lib/rewards";
import { checkRateLimit } from "@/lib/rate-limit";
import { isReactionType, type ReactionType } from "@/lib/reactions";
import { shouldNotify } from "@/lib/notification-preferences";
import { fetchPostsPage, type PostListItem } from "./posts";
import { buildNotification } from "@/lib/notification-payloads";

const MAX_POST_LENGTH = 2000;

// Item 141: create_post's own rate limit (5/60s below) only throttles
// posting speed, not XP over a full day — someone posting every couple of
// minutes all day would still farm unlimited XP. This is a second,
// XP-specific check on the same rate_limit_events/checkRateLimit machinery,
// keyed separately so it never blocks the post itself, only whether this one
// awards XP: past the cap, checkRateLimit still records the attempt (so the
// window keeps sliding) but posting keeps working with no XP.
const MAX_XP_POSTS_PER_DAY = 10;

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
    console.error("Failed to create post", error);
    return { error: "Couldn't publish your post. Try again." };
  }

  // awardBadge is a harmless no-op on repeat posts (unique constraint on
  // user_badges swallows the duplicate) — no need to check "is this their first."
  // Item 141: XP itself is capped separately from the post succeeding — a
  // user past today's XP cap keeps posting normally, they just stop earning
  // XP for it until the 24h window rolls over.
  const xpAllowance = await checkRateLimit(`user:${profile.id}`, "create_post_xp", MAX_XP_POSTS_PER_DAY, 60 * 60 * 24);
  await Promise.all([
    xpAllowance.ok ? awardXp(profile.id, 2, "Posted in the community", `post:${created.id}`) : Promise.resolve(),
    awardBadge(profile.id, "first_post"),
  ]);

  await maybeAwardTenPostsBadge(supabase, profile.id);

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

  const supabase = createServerSupabaseClient();
  const { data: post, error: postError } = await supabase
    .from("posts")
    .insert({ author_profile_id: profile.id, body })
    .select("id")
    .single();

  if (postError || !post) {
    console.error("Failed to create poll post", postError);
    return { error: "Couldn't publish your poll. Try again." };
  }

  const { error: optionsError } = await supabase
    .from("poll_options")
    .insert(options.map((label, position) => ({ post_id: post.id, position, label })));

  if (optionsError) {
    console.error("Failed to create poll options", optionsError);
    await supabase.from("posts").delete().eq("id", post.id);
    return { error: "Couldn't publish your poll. Try again." };
  }

  const xpAllowance = await checkRateLimit(`user:${profile.id}`, "create_post_xp", MAX_XP_POSTS_PER_DAY, 60 * 60 * 24);
  await Promise.all([
    // KN-91: same key shape as createPost above — a poll is a post.
    xpAllowance.ok ? awardXp(profile.id, 2, "Posted in the community", `post:${post.id}`) : Promise.resolve(),
    awardBadge(profile.id, "first_post"),
  ]);

  await maybeAwardTenPostsBadge(supabase, profile.id);

  revalidatePath("/social");
  return { error: null };
}

/**
 * Records (or changes) the caller's vote on a poll post — delete-then-insert,
 * same convention as setReaction below, since poll_votes_unique_per_user
 * means only one row per (post, profile) can exist at a time. optionId is
 * verified against postId via a plain public select first so a stale or
 * tampered pairing fails with a real error rather than the trigger silently
 * attaching the vote to a different poll than the UI showed the user.
 */
export async function voteOnPoll(postId: string, optionId: string) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to vote." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "vote_on_poll", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();

  const { data: option } = await supabase.from("poll_options").select("id").eq("id", optionId).eq("post_id", postId).maybeSingle();
  if (!option) return { error: "That poll option no longer exists." };

  const { error: deleteError } = await supabase.from("poll_votes").delete().eq("post_id", postId).eq("profile_id", profile.id);
  if (deleteError) {
    console.error("Failed to clear existing poll vote", deleteError);
    return { error: "Couldn't record your vote. Try again." };
  }

  const { error: insertError } = await supabase
    .from("poll_votes")
    .insert({ post_id: postId, option_id: optionId, profile_id: profile.id });
  if (insertError) {
    console.error("Failed to record poll vote", insertError);
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

  const { error: deleteError } = await supabase
    .from("reactions")
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("profile_id", profile.id);

  if (deleteError) {
    console.error("Failed to clear existing reaction", deleteError);
    return { error: "Couldn't update your reaction." };
  }

  if (reactionType !== null) {
    const { error: insertError } = await supabase.from("reactions").insert({
      target_type: targetType,
      target_id: targetId,
      profile_id: profile.id,
      reaction_type: reactionType,
    });

    if (insertError) {
      console.error("Failed to set reaction", insertError);
      return { error: "Couldn't update your reaction." };
    }

    if (targetType === "post") {
      await notifyPostLiked(targetId, profile);
    }
  }

  revalidatePath("/social");
  return { error: null };
}

/** Appends the next page of `/social` posts, offset-based to match the
 * `loadMoreLeagues` / `loadMoreTeams` pattern (see components/leagues/leagues-list.tsx).
 * `followingOnly` (RECOMMENDATIONS item 175) threads through to fetchPostsPage
 * so "Load more" keeps respecting whichever tab the viewer had selected. */
export async function loadMorePosts(
  offset: number,
  options?: { followingOnly?: boolean },
): Promise<{ error: string | null; posts: PostListItem[]; hasMore: boolean }> {
  const profile = await getOrCreateProfile();
  return fetchPostsPage(offset, profile?.id ?? null, options);
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

  // KN-90: the typed constructor, not an object literal — a dropped or renamed
  // field is now a type error here rather than a notification that renders
  // normally and whose link goes nowhere.
  //
  // fixture_id (nullable) lets the bell/notifications page route back to the
  // fixture's Match Centre Room tab for a room post, vs. /social for a
  // general one — see notificationHref() in lib/notification-registry.ts.
  const { error } = await serviceClient.from("notifications").insert(
    buildNotification(post.author_profile_id, "post_like", {
      post_id: postId,
      fixture_id: post.fixture_id,
      liker_username: liker.username,
      liker_display_name: liker.display_name,
    }),
  );

  if (error) console.error("Failed to create like notification", error);
}
