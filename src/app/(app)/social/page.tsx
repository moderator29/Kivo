import type { Metadata } from "next";
import { getOrCreateProfile } from "@/lib/profile";
import { PostComposer } from "@/components/social/post-composer";
import { SocialFeed } from "@/components/social/social-feed";
import { FadeIn } from "@/components/ui/fade-in";
import { fetchPostsPage } from "./posts";

export const metadata: Metadata = { title: "Social" };

export default async function SocialPage() {
  const profile = await getOrCreateProfile();
  const { posts, hasMore } = await fetchPostsPage(0, profile?.id ?? null);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Community</h1>
      </FadeIn>

      <FadeIn delay={0.06}>
        <PostComposer signedIn={Boolean(profile)} />
      </FadeIn>

      <SocialFeed initialPosts={posts} initialHasMore={hasMore} signedIn={Boolean(profile)} />
    </div>
  );
}
