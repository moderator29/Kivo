import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/ui/skeletons";

export default function TransfersLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading Transfers">
      <PageHeaderSkeleton titleWidth="w-44" />

      {/* The status explainer, which is a real paragraph on the page and not a
          decoration — leaving it out here is 60px of reflow. */}
      <Skeleton className="h-14 w-full rounded-2xl" />

      <div className="kivo-glass-sharp grid grid-cols-2 gap-3 rounded-2xl p-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3.5 w-3.5 shrink-0" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-hairline-soft pt-3">
              <Skeleton className="h-4 w-20 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
