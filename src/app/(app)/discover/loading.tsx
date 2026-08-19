import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function DiscoverLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8" label="Loading Discover">
      <div className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-6">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="kivo-glass rounded-2xl p-5">
            <div className="mb-4 flex items-center gap-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="mt-1.5 h-3.5 w-3/4" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
