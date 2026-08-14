"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";

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
};

/**
 * Lazy-loaded on expand rather than joined into the initial `/social` query:
 * most posts never get their thread opened, so this keeps the feed's first
 * paint cheap. `comments_select_public` grants anon read, same as posts, so
 * this is safe to call for guests too (only `createComment` below is gated).
 */
export async function getComments(postId: string): Promise<{ comments: CommentDTO[]; error: string | null }> {
  const supabase = createServerSupabaseClient();
  const { data: comments, error } = await supabase
    .from("comments")
    .select("id, post_id, parent_comment_id, body, created_at, author_profile_id")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to load comments", error);
    return { comments: [], error: "Couldn't load comments. Try again." };
  }

  // profiles_select_own_or_admin restricts a plain select to the caller's own
  // row, so a comment's author (almost always someone else) can't be read
  // that way — same narrow SECURITY DEFINER function already used for post
  // authors on /social, not a second RPC.
  const authorIds = [...new Set((comments ?? []).map((c) => c.author_profile_id))];
  const { data: authors } = authorIds.length
    ? await supabase.rpc("get_public_profiles", { p_ids: authorIds })
    : { data: [] };
  const authorById = new Map((authors ?? []).map((a) => [a.id, a]));

  return {
    comments: (comments ?? []).map((c) => {
      const author = authorById.get(c.author_profile_id);
      return {
        id: c.id,
        postId: c.post_id,
        parentCommentId: c.parent_comment_id,
        body: c.body,
        createdAt: c.created_at,
        authorName: author?.display_name || author?.username || "KIVO fan",
      };
    }),
    error: null,
  };
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

  revalidatePath("/social");

  const comment: CommentDTO = {
    id: inserted.id,
    postId,
    parentCommentId,
    body: trimmed,
    createdAt: inserted.created_at,
    authorName: profile.display_name || profile.username,
  };

  return { error: null, comment };
}
