import { Skeleton } from "@/components/ui/skeleton";

export default function SavedLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-3.5 w-52" />
      </div>

      {Array.from({ length: 2 }).map((_, section) => (
        <div key={section} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          <div className="kivo-glass flex flex-col divide-y divide-white/5 rounded-2xl">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <Skeleton className="h-3.5 w-36" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
