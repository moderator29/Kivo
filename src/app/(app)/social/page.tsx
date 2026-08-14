import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { PostComposer } from "@/components/social/post-composer";
import { PostCard } from "@/components/social/post-card";
import { Users } from "lucide-react";

export default async function SocialPage() {
  const profile = await getOrCreateProfile();
  const supabase = createServerSupabaseClient();

  const { data: posts } = await supabase
    .from("posts")
    .select("id, body, created_at, author:profiles!posts_author_profile_id_fkey(username, display_name)")
    .order("created_at", { ascending: false })
    .limit(50);

  const postIds = posts?.map((p) => p.id) ?? [];
  const { data: reactions } = postIds.length
    ? await supabase
        .from("reactions")
        .select("target_id, profile_id")
        .eq("target_type", "post")
        .eq("reaction_type", "like")
        .in("target_id", postIds)
    : { data: [] };

  const likesByPost = new Map<string, { count: number; likedByViewer: boolean }>();
  for (const reaction of reactions ?? []) {
    const entry = likesByPost.get(reaction.target_id) ?? { count: 0, likedByViewer: false };
    entry.count += 1;
    if (profile && reaction.profile_id === profile.id) entry.likedByViewer = true;
    likesByPost.set(reaction.target_id, entry);
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 lg:px-8">
      <h1 className="text-xl font-semibold text-foreground">Community</h1>

      <PostComposer />

      {!posts || posts.length === 0 ? (
        <div className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-10 text-center">
          <Users className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
          <p className="text-sm text-foreground-muted">
            Nobody&apos;s posted yet — be the first to share your take on the game.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post, index) => {
            const likes = likesByPost.get(post.id) ?? { count: 0, likedByViewer: false };
            const author = post.author;
            const authorName = author?.display_name || author?.username || "KIVO fan";
            return (
              <PostCard
                key={post.id}
                id={post.id}
                body={post.body}
                createdAt={post.created_at}
                authorName={authorName}
                likeCount={likes.count}
                likedByViewer={likes.likedByViewer}
                index={index}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
