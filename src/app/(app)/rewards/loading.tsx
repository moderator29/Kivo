import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function RewardsLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading Rewards">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3.5 w-48" />
      </div>

      <div className="kivo-glass-brand flex items-center gap-4 rounded-3xl p-6">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-16 w-full rounded-3xl" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
