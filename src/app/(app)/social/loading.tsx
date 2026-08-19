import { PageSkeleton } from "@/components/ui/page-skeleton";
import { PageHeaderSkeleton, PostSkeleton, SectionTabsSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The feed's wait, shaped like the feed.
 *
 * Built from the skeleton family (docs/UI_PRIMITIVES.md) rather than from
 * hand-measured boxes, because a skeleton is a promise about where things will
 * be and the visible way to break it is to get the geometry wrong: content
 * lands, the page jumps. `PostSkeleton` is measured against the real card, so
 * it cannot drift from it.
 */
export default function SocialLoading() {
  return (
    <PageSkeleton label="Loading the community feed">
      <PageHeaderSkeleton />
      {/* The composer row: an avatar, a placeholder line and the Post button. */}
      <div className="kivo-glass flex items-center gap-3 rounded-2xl p-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <Skeleton className="h-3.5 flex-1" />
        <Skeleton className="h-8 w-16 shrink-0 rounded-xl" />
      </div>
      <SectionTabsSkeleton />
      <PostSkeleton />
    </PageSkeleton>
  );
}
