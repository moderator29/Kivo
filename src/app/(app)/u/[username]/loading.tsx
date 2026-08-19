import { PageSkeleton } from "@/components/ui/page-skeleton";
import { PostSkeleton, SectionTabsSkeleton } from "@/components/ui/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A profile's wait, shaped like the profile it is waiting for: the header, the
 * XP band, the section rail and the posts that now open underneath it. The
 * posts are the part that changed — this used to promise a badge grid, which
 * is no longer what lands first, and a skeleton that promises the wrong layout
 * is a reflow with extra steps.
 */
export default function PublicProfileLoading() {
  return (
    <PageSkeleton label="Loading this profile">
      <div className="kivo-glass flex items-center gap-4 rounded-2xl p-5">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4.5 w-32" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <Skeleton className="h-8 w-20 shrink-0 rounded-xl" />
      </div>

      <div className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-5">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      <SectionTabsSkeleton />
      <PostSkeleton posts={2} />
    </PageSkeleton>
  );
}
