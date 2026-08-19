import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlayersLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8" label="Loading Players">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-4 w-48" />
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="kivo-glass-sharp flex items-center gap-3 rounded-xl p-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
