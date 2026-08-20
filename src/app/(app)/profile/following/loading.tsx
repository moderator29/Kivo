import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function FollowingLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading who you follow">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3.5 w-52" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <div className="kivo-glass flex flex-col divide-y divide-hairline-soft rounded-2xl">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-[28%]" />
              <Skeleton className="h-3.5 w-32" />
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
