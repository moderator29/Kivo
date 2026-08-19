import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the transfer page's own block order — header card, alerts,
 * timeline, data panel — so the resolved page settles into the skeleton's
 * shape rather than replacing it. */
export default function TransferDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-24 rounded-full" />
      </div>

      <div className="kivo-glass flex flex-col gap-5 rounded-3xl p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-3 w-32" />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-1 p-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-12 w-12 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
        <Skeleton className="h-14 w-full rounded-2xl" />
      </div>

      <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-64" />
        <Skeleton className="h-8 w-48 rounded-xl" />
      </div>

      <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
        <Skeleton className="h-4 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
