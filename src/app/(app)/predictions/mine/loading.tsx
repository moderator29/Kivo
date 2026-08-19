import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function MyPredictionsLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8" label="Loading your predictions">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-56" />
      </div>

      <div className="kivo-glass-brand grid grid-cols-3 gap-2 rounded-2xl p-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-6 w-10" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kivo-glass flex items-center justify-between gap-3 rounded-2xl p-4">
            <div className="flex flex-1 items-center gap-2">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
            </div>
            <Skeleton className="h-3.5 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </PageSkeleton>
  );
}
