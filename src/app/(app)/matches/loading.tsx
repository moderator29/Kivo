import { Skeleton } from "@/components/ui/skeleton";

export default function MatchesLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="flex items-center gap-1.5">
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-11 shrink-0 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-1 items-center gap-2">
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-8 shrink-0" />
              <div className="flex flex-1 items-center justify-end gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
