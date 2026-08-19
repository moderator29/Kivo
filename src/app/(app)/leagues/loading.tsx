import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function LeaguesLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8" label="Loading Leagues">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <div className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
