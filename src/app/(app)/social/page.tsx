import type { Metadata } from "next";
import Link from "next/link";
import { ShieldHalf, Users } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { ComposeEntry } from "@/components/social/compose-entry";
import { FeedFilterTabs } from "@/components/social/feed-filter-tabs";
import { SocialFeed } from "@/components/social/social-feed";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/fade-in";
import { EmptyState } from "@/components/ui/empty-state";
import { WidgetErrorBoundary } from "@/components/ui/soft-error-boundary";
import { TabPanel } from "@/components/ui/section-tabs";
import { parseSocialFilter, resolveFeedScope } from "@/lib/social-filters";
import { fetchPostsPage } from "./posts";
import { fetchTrendingRooms } from "./trending";
import { TrendingPanel } from "@/components/social/trending-panel";

export const metadata: Metadata = { title: "Social" };

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; post?: string }>;
}) {
  const { filter: filterParam, post: targetPostId } = await searchParams;
  const filter = parseSocialFilter(filterParam);

  const profile = await getOrCreateProfile();
  const scope = resolveFeedScope(filter, profile);

  // "Unavailable" is not an empty feed: Club mates with no club chosen, or
  // Rivals with no rival named, cannot be built at all. Nothing is queried,
  // and the page says which of the two it is and where to fix it — rather
  // than rendering an empty list that reads as "nobody has posted".
  const { posts: pageOne, hasMore } =
    scope.kind === "unavailable"
      ? { posts: [], hasMore: false }
      : await fetchPostsPage(0, profile?.id ?? null, {
          followingOnly: scope.kind === "following",
          teamId: scope.kind === "team" ? scope.teamId : undefined,
        });

  // RECOMMENDATIONS item 237: a notification's `?post=<id>` link names a
  // specific post that might sit past whatever this first page would normally
  // load — fetch it explicitly and prepend it rather than relying on it
  // already being in the DOM.
  let posts = pageOne;
  if (targetPostId && !pageOne.some((p) => p.id === targetPostId)) {
    const { posts: targetPosts } = await fetchPostsPage(0, profile?.id ?? null, { postIds: [targetPostId] });
    if (targetPosts.length > 0) posts = [...targetPosts, ...pageOne];
  }

  // Signed-in only: `get_trending_match_rooms` is granted to `authenticated`,
  // and a guest has no Room to be sent into anyway.
  const trending = profile ? await fetchTrendingRooms() : null;

  return (
    <div className="kivo-page">
      <PageHeader title="Community" description="Takes, polls and match talk from KIVO fans." />

      <FadeIn delay={0.04}>
        <ComposeEntry signedIn={Boolean(profile)} avatarUrl={profile ? resolveAvatarSrc(profile) : null} />
      </FadeIn>

      {/* Above the feed rather than beside it: on a phone there is no beside,
          and "what is everyone in right now" is the question this page is
          most often opened to answer. Wrapped so a failure here can never take
          the feed down with it — trending is context, the feed is the page. */}
      {trending && (
        <FadeIn delay={0.05}>
          <WidgetErrorBoundary context="social.trending" label="Match rooms people are in">
            <TrendingPanel result={trending} />
          </WidgetErrorBoundary>
        </FadeIn>
      )}

      {/* Only shown signed in — every filter but "All" is scoped to the
          viewer's own follows or their own club, so a guest's tabs could only
          ever be empty. */}
      {profile && (
        <FadeIn delay={0.06}>
          <FeedFilterTabs active={filter} />
        </FadeIn>
      )}

      {/* The panel the rail above owns. Only wired up when the rail is on
          screen: `aria-labelledby` pointing at a tab a guest never gets is
          worse than no wiring at all. */}
      <FeedRegion signedIn={Boolean(profile)} filter={filter}>
        {scope.kind === "unavailable" ? (
          <EmptyState
            icon={scope.missing === "rival" ? ShieldHalf : Users}
            tone="section"
            title={scope.missing === "rival" ? "You haven't named a rival yet" : "You haven't picked a club yet"}
            description={
              scope.missing === "rival"
                ? "KIVO holds no list of which clubs are rivals. Name the one club you want to hear from and this feed fills up on its own."
                : "Club mates shows posts from other fans of the club you support. Tell KIVO which one that is."
            }
            action={
              <Link
                href={scope.missing === "rival" ? "/settings/clubs" : "/profile/club"}
                className="kivo-gradient-prime kivo-raise kivo-focus rounded-xl px-4 py-2 text-sm font-semibold text-on-accent"
              >
                {scope.missing === "rival" ? "Name your rival" : "Pick your club"}
              </Link>
            }
          />
        ) : (
          // key remounts SocialFeed when the filter changes: its `posts` state is
          // seeded once via useState(initialPosts), so without a key tied to the
          // filter, clicking a tab re-renders this server component with
          // correctly-filtered `posts` while the mounted client feed keeps
          // showing its stale list.
          <WidgetErrorBoundary context="socialFeed" label="The feed">
            <SocialFeed
              key={filter}
              initialPosts={posts}
              initialHasMore={hasMore}
              signedIn={Boolean(profile)}
              filter={filter}
              scrollToPostId={targetPostId ?? null}
              initialOffset={pageOne.length}
            />
          </WidgetErrorBoundary>
        )}
      </FeedRegion>
    </div>
  );
}

/** The feed and its two honest alternatives, wrapped in the tab rail's panel
 * when there is a rail to belong to. */
function FeedRegion({
  signedIn,
  filter,
  children,
}: {
  signedIn: boolean;
  filter: string;
  children: React.ReactNode;
}) {
  if (!signedIn) return <>{children}</>;
  return (
    <TabPanel idPrefix="social-feed" tab={filter} active>
      {children}
    </TabPanel>
  );
}
