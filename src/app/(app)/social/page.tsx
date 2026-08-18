import type { Metadata } from "next";
import Link from "next/link";
import { getOrCreateProfile } from "@/lib/profile";
import { PostComposer } from "@/components/social/post-composer";
import { SocialFeed } from "@/components/social/social-feed";
import { FadeIn } from "@/components/ui/fade-in";
import { WidgetErrorBoundary } from "@/components/ui/soft-error-boundary";
import { fetchPostsPage } from "./posts";

export const metadata: Metadata = { title: "Social" };

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; post?: string }>;
}) {
  const { filter, post: targetPostId } = await searchParams;
  const followingOnly = filter === "following";

  const profile = await getOrCreateProfile();
  const { posts: pageOne, hasMore } = await fetchPostsPage(0, profile?.id ?? null, { followingOnly });

  // RECOMMENDATIONS item 237: a notification's `?post=<id>` link (see
  // postHref() in lib/notification-registry.ts) names a specific post that
  // might sit past whatever this first page would normally load — fetch it
  // explicitly and prepend it rather than relying on it already being in the
  // DOM. `fetchPostsPage`'s own `postIds` option (already built for /saved)
  // does the same joins as every other post on this page, so it renders
  // identically once merged in.
  let posts = pageOne;
  if (targetPostId && !pageOne.some((p) => p.id === targetPostId)) {
    const { posts: targetPosts } = await fetchPostsPage(0, profile?.id ?? null, { postIds: [targetPostId] });
    if (targetPosts.length > 0) posts = [...targetPosts, ...pageOne];
  }

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
        <FadeIn delay={0.08} className="flex w-fit gap-4 border-b border-hairline">
          <Link
            href="/social"
            className={`relative px-1 py-2.5 text-xs font-semibold transition-colors ${
              followingOnly ? "text-foreground-subtle hover:text-foreground-muted" : "text-foreground"
            }`}
          >
            All
            {!followingOnly && <span className="kivo-gradient-prime absolute inset-x-0 -bottom-px h-0.5 rounded-full" />}
          </Link>
          <Link
            href="/social?filter=following"
            className={`relative px-1 py-2.5 text-xs font-semibold transition-colors ${
              followingOnly ? "text-foreground" : "text-foreground-subtle hover:text-foreground-muted"
            }`}
          >
            Following
            {followingOnly && <span className="kivo-gradient-prime absolute inset-x-0 -bottom-px h-0.5 rounded-full" />}
          </Link>
        </FadeIn>
      )}

      {/* key remounts SocialFeed when the All/Following tab changes: its
          `posts` state is seeded once via useState(initialPosts), so without
          a key tied to the filter, clicking the tab link above re-renders
          this server component with correctly-filtered `posts` but the
          already-mounted client SocialFeed keeps showing its stale list. */}
      <WidgetErrorBoundary context="socialFeed" label="The feed">
        <SocialFeed
          key={followingOnly ? "following" : "all"}
          initialPosts={posts}
          initialHasMore={hasMore}
          signedIn={Boolean(profile)}
          followingOnly={followingOnly}
          scrollToPostId={targetPostId ?? null}
          initialOffset={pageOne.length}
        />
      </WidgetErrorBoundary>
    </div>
  );
}
