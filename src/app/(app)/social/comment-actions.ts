"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge } from "@/lib/rewards";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { aggregateReactions, type ReactionType } from "@/lib/reactions";
import { checkRateLimit } from "@/lib/rate-limit";
import { shouldNotify } from "@/lib/notification-preferences";
import { buildNotification } from "@/lib/notification-payloads";

// Matches the `comments_body_length` check constraint in
// supabase/migrations/0001_kivo_core_schema.sql (char_length between 1 and 1000).
const MAX_COMMENT_LENGTH = 1000;

export type CommentDTO = {
  id: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
  createdAt: string;
  authorName: string;
  authorUsername: string | null;
  authorAvatarSrc: string | null;
  /** Audit item 6: ReactionPicker already accepts targetType="comment" and a
   * size="sm" variant sized for a comment row, and the reactions schema/RLS
   * already support target_type='comment' — this was the missing data plumbing
   * that kept comments reactable in the DB but not in the UI. */
  reactionCount: number;
  viewerReaction: ReactionType | null;
};

/**
 * Lazy-loaded on expand rather than joined into the initial `/social` query:
 * most posts never get their thread opened, so this keeps the feed's first
 * paint cheap. `comments_select_public` grants anon read, same as posts, so
 * this is safe to call for guests too (only `createComment` below is gated).
 */
export async function getComments(postId: string): Promise<{ comments: CommentDTO[]; error: string | null }> {
  const supabase = createServerSupabaseClient();
  const [{ data: comments, error }, viewerProfile] = await Promise.all([
    supabase
      .from("comments")
      .select("id, post_id, parent_comment_id, body, created_at, author_profile_id")
      .eq("post_id", postId)
      .order("created_at", { ascending: true }),
    // Guests get null here (getOrCreateProfile returns null when signed out),
    // which aggregateReactions already treats as "no viewer reaction" below —
    // same as fetchPostsPage's viewerProfileId handling in posts.ts.
    getOrCreateProfile(),
  ]);

  if (error) {
    console.error("Failed to load comments", error);
    return { comments: [], error: "Couldn't load comments. Try again." };
  }

  // profiles_select_own_or_admin restricts a plain select to the caller's own
  // row, so a comment's author (almost always someone else) can't be read
  // that way — same narrow SECURITY DEFINER function already used for post
  // authors on /social, not a second RPC.
  const authorIds = [...new Set((comments ?? []).map((c) => c.author_profile_id))];
  const commentIds = (comments ?? []).map((c) => c.id);
  const [{ data: authors }, { data: reactions }] = await Promise.all([
    authorIds.length ? supabase.rpc("get_public_profiles", { p_ids: authorIds }) : Promise.resolve({ data: [] }),
    // Audit item 6: reactions on comments — same aggregateReactions shape
    // fetchPostsPage already uses for posts (src/app/(app)/social/posts.ts).
    commentIds.length
      ? supabase.from("reactions").select("target_id, profile_id, reaction_type").eq("target_type", "comment").in("target_id", commentIds)
      : Promise.resolve({ data: [] }),
  ]);
  const authorById = new Map((authors ?? []).map((a) => [a.id, a]));
  const reactionsByComment = aggregateReactions(reactions ?? [], viewerProfile?.id ?? null);

  return {
    comments: (comments ?? []).map((c) => {
      const author = authorById.get(c.author_profile_id);
      const reactionSummary = reactionsByComment.get(c.id) ?? { count: 0, viewerReaction: null };
      return {
        id: c.id,
        postId: c.post_id,
        parentCommentId: c.parent_comment_id,
        body: c.body,
        createdAt: c.created_at,
        authorName: author?.display_name || author?.username || "KIVO fan",
        authorUsername: author?.username ?? null,
        authorAvatarSrc: author ? resolveAvatarSrc(author) : null,
        reactionCount: reactionSummary.count,
        viewerReaction: reactionSummary.viewerReaction,
      };
    }),
    error: null,
  };
}

/**
 * Audit item 9: `post_comment`/`comment_reply` were fully registered in
 * notification-registry.ts (icon, copy, href) but had no producer anywhere —
 * a repo-wide grep for `.from("notifications").insert` only ever found
 * match-notifications.ts and social/actions.ts's notifyPostLiked; this file
 * never inserted into `notifications` at all. Mirrors notifyPostLiked's
 * pattern: a top-level comment notifies the post's author, a reply notifies
 * the parent comment's author instead (never both), and never the commenter
 * about their own comment/reply. Goes through the service-role client
 * deliberately — notifications has no client-facing insert policy by design.
 */
async function notifyComment(
  postId: string,
  parentCommentId: string | null,
  commenter: { id: string; username: string; display_name: string | null },
) {
  const supabase = createServerSupabaseClient();
  const { data: post } = await supabase.from("posts").select("author_profile_id, fixture_id").eq("id", postId).maybeSingle();
  if (!post) return;

  let recipientId = post.author_profile_id;
  let type: "post_comment" | "comment_reply" = "post_comment";

  if (parentCommentId) {
    const { data: parent } = await supabase
      .from("comments")
      .select("author_profile_id")
      .eq("id", parentCommentId)
      .maybeSingle();
    if (!parent) return;
    recipientId = parent.author_profile_id;
    type = "comment_reply";
  }

  if (recipientId === commenter.id) return;

  const serviceClient = createServiceRoleSupabaseClient();

  // RECOMMENDATIONS.md item 285: gate before writing, not after.
  if (!(await shouldNotify(serviceClient, recipientId, "social_alerts_enabled"))) return;

  // KN-90: the typed constructor. This producer is the one that most needed
  // it — the actor keys used to be built with a computed property name
  // (`[`${actorPrefix}_username`]`), which typechecks against an untyped jsonb
  // column no matter what string it produces. A typo in that prefix would have
  // written a payload the registry could not read, silently, with no failure
  // anywhere. The two branches are now written out, which is longer and is the
  // point: each one is checked against the payload type for its own
  // notification type.
  //
  // fixture_id (nullable) lets the bell/notifications page route back to
  // the fixture's Match Centre Room tab for a room post, vs. /social for a
  // general one — see postHref() in lib/notification-registry.ts.
  const notification =
    type === "post_comment"
      ? buildNotification(recipientId, "post_comment", {
          post_id: postId,
          fixture_id: post.fixture_id,
          commenter_username: commenter.username,
          commenter_display_name: commenter.display_name,
        })
      : buildNotification(recipientId, "comment_reply", {
          post_id: postId,
          fixture_id: post.fixture_id,
          replier_username: commenter.username,
          replier_display_name: commenter.display_name,
        });

  const { error } = await serviceClient.from("notifications").insert(notification);
  if (error) console.error("Failed to create comment notification", error);
}

/**
 * `parent_comment_id` self-references `comments` with no depth limit in the
 * schema, but the UI only ever sets it to a *top-level* comment's id (see
 * comment-thread.tsx) — one level of replies, not arbitrary nesting, matching
 * what's actually rendered rather than what the column would technically
 * allow.
 */
export async function createComment(postId: string, body: string, parentCommentId: string | null = null) {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_COMMENT_LENGTH) {
    return { error: `Comment must be between 1 and ${MAX_COMMENT_LENGTH} characters.`, comment: null };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to comment.", comment: null };
  }

  // Item 239: comment-actions.ts had no checkRateLimit call at all, unlike
  // createPost/toggleLike/toggleFollow/submitPrediction/searchPlatform.
  // Same 5-per-60s window as createPost's own "create_post" limit
  // (social/actions.ts) — comments are the same "short free-text write"
  // shape as a post, just scoped to a thread instead of the feed, so there's
  // no reason for a looser or tighter cap here. This one function backs both
  // top-level comments and replies (parentCommentId), so a single action key
  // covers both.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "create_comment", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error, comment: null };

  const supabase = createServerSupabaseClient();
  const { data: inserted, error } = await supabase
    .from("comments")
    .insert({
      post_id: postId,
      author_profile_id: profile.id,
      parent_comment_id: parentCommentId,
      body: trimmed,
    })
    .select("id, created_at")
    .single();

  if (error || !inserted) {
    console.error("Failed to create comment", error);
    return { error: "Couldn't post your comment. Try again.", comment: null };
  }

  // awardBadge is a harmless no-op on repeat comments (unique constraint on
  // user_badges swallows the duplicate) — same pattern as first_post.
  await awardBadge(profile.id, "first_comment");
  await notifyComment(postId, parentCommentId, profile);

  revalidatePath("/social");

  const comment: CommentDTO = {
    id: inserted.id,
    postId,
    parentCommentId,
    body: trimmed,
    createdAt: inserted.created_at,
    authorName: profile.display_name || profile.username,
    authorUsername: profile.username,
    authorAvatarSrc: resolveAvatarSrc(profile),
    reactionCount: 0,
    viewerReaction: null,
  };

  return { error: null, comment };
}
