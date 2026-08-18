import { Skeleton } from "@/components/ui/skeleton";

export default function PublicProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="kivo-glass flex items-center gap-4 rounded-2xl p-5">
        <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4.5 w-32" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <Skeleton className="h-8 w-20 shrink-0 rounded-xl" />
      </div>

      <div className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-5">
        <Skeleton className="h-12 w-12 shrink-0 rounded-2xl" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-16" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
