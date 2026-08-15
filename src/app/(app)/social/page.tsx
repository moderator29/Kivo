import type { Metadata } from "next";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { PostComposer } from "@/components/social/post-composer";
import { PostCard } from "@/components/social/post-card";
import { FadeIn } from "@/components/ui/fade-in";
import { Users } from "lucide-react";

export const metadata: Metadata = { title: "Social" };

export default async function SocialPage() {
  const profile = await getOrCreateProfile();
  const supabase = createServerSupabaseClient();

  const { data: posts } = await supabase
    .from("posts")
    .select("id, body, created_at, author_profile_id")
    .order("created_at", { ascending: false })
    .limit(50);

  const postIds = posts?.map((p) => p.id) ?? [];
  // profiles_select_own_or_admin restricts a plain select to the caller's own
  // row, so a post's author (almost always someone else) can't be read that
  // way — go through the narrow SECURITY DEFINER function instead, same
  // reasoning as the fantasy leaderboard RPC. Real author identity, not a
  // fabricated placeholder.
  const authorIds = [...new Set((posts ?? []).map((p) => p.author_profile_id))];
  const [{ data: reactions }, { data: authors }, { data: comments }] = await Promise.all([
    postIds.length
      ? supabase
          .from("reactions")
          .select("target_id, profile_id")
          .eq("target_type", "post")
          .eq("reaction_type", "like")
          .in("target_id", postIds)
      : Promise.resolve({ data: [] }),
    authorIds.length ? supabase.rpc("get_public_profiles", { p_ids: authorIds }) : Promise.resolve({ data: [] }),
    // Just the post_id column to keep this a cheap count, not a full thread
    // fetch — full comment bodies are lazy-loaded per post on expand (see
    // comment-actions.ts / comment-thread.tsx).
    postIds.length ? supabase.from("comments").select("post_id").in("post_id", postIds) : Promise.resolve({ data: [] }),
  ]);

  const authorById = new Map((authors ?? []).map((a) => [a.id, a]));

  const likesByPost = new Map<string, { count: number; likedByViewer: boolean }>();
  for (const reaction of reactions ?? []) {
    const entry = likesByPost.get(reaction.target_id) ?? { count: 0, likedByViewer: false };
    entry.count += 1;
    if (profile && reaction.profile_id === profile.id) entry.likedByViewer = true;
    likesByPost.set(reaction.target_id, entry);
  }

  const commentCountByPost = new Map<string, number>();
  for (const comment of comments ?? []) {
    commentCountByPost.set(comment.post_id, (commentCountByPost.get(comment.post_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Community</h1>
      </FadeIn>

      <FadeIn delay={0.06}>
        <PostComposer signedIn={Boolean(profile)} />
      </FadeIn>

      {!posts || posts.length === 0 ? (
        <FadeIn delay={0.12} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Users className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            Nobody&apos;s posted yet. Be the first to share your take on the game.
          </p>
        </FadeIn>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post, index) => {
            const likes = likesByPost.get(post.id) ?? { count: 0, likedByViewer: false };
            const author = authorById.get(post.author_profile_id);
            const authorName = author?.display_name || author?.username || "KIVO fan";
            return (
              <PostCard
                key={post.id}
                id={post.id}
                body={post.body}
                createdAt={post.created_at}
                authorName={authorName}
                authorUsername={author?.username ?? null}
                likeCount={likes.count}
                likedByViewer={likes.likedByViewer}
                commentCount={commentCountByPost.get(post.id) ?? 0}
                signedIn={Boolean(profile)}
                index={index}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
