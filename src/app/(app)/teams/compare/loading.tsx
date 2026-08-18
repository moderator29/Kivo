import { Skeleton } from "@/components/ui/skeleton";

export default function TeamsCompareLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3.5 w-64" />
      </div>

      <div className="flex gap-3">
        <Skeleton className="h-11 flex-1 rounded-xl" />
        <Skeleton className="h-11 flex-1 rounded-xl" />
      </div>

      <div className="kivo-glass grid grid-cols-2 gap-6 rounded-2xl p-6">
        {Array.from({ length: 2 }).map((_, col) => (
          <div key={col} className="flex flex-col items-center gap-3">
            <Skeleton className="h-14 w-14 rounded-full" />
            <Skeleton className="h-4 w-24" />
            <div className="flex w-full flex-col gap-2 pt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-3.5 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
