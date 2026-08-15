import type { Metadata } from "next";
import Link from "next/link";
import { getOrCreateProfile } from "@/lib/profile";
import { PostComposer } from "@/components/social/post-composer";
import { SocialFeed } from "@/components/social/social-feed";
import { FadeIn } from "@/components/ui/fade-in";
import { fetchPostsPage } from "./posts";

export const metadata: Metadata = { title: "Social" };

export default async function SocialPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter } = await searchParams;
  const followingOnly = filter === "following";

  const profile = await getOrCreateProfile();
  const { posts, hasMore } = await fetchPostsPage(0, profile?.id ?? null, { followingOnly });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Community</h1>
      </FadeIn>

      <FadeIn delay={0.06}>
        <PostComposer signedIn={Boolean(profile)} />
      </FadeIn>

      {/* RECOMMENDATIONS item 175: only shown signed in — follows are
          owner-scoped, so a guest's "Following" tab could only ever be
          empty. Plain server-rendered links (not a client tab switch): the
          filter is a real navigation to a different query, not client-only
          UI state, matching how /transfers' filters work. */}
      {profile && (
        <FadeIn delay={0.08} className="kivo-glass-sharp flex w-fit rounded-xl p-1">
          <Link
            href="/social"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              followingOnly ? "text-foreground-subtle hover:text-foreground-muted" : "bg-white/10 text-foreground"
            }`}
          >
            All
          </Link>
          <Link
            href="/social?filter=following"
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              followingOnly ? "bg-white/10 text-foreground" : "text-foreground-subtle hover:text-foreground-muted"
            }`}
          >
            Following
          </Link>
        </FadeIn>
      )}

      <SocialFeed initialPosts={posts} initialHasMore={hasMore} signedIn={Boolean(profile)} followingOnly={followingOnly} />
    </div>
  );
}
