import { Skeleton } from "@/components/ui/skeleton";

/** Mirrors the real page's shape: cover band, overlapping avatar, identity
 * lines, the three-cell rail, then the tab bar and its first rows. A skeleton
 * that doesn't match what arrives is worse than none — it moves everything
 * once the data lands. */
export default function ProfileLoading() {
  return (
    <div className="kivo-page">
      <div className="kivo-glass overflow-hidden rounded-3xl">
        <Skeleton className="h-32 w-full rounded-none sm:h-44" />
        <div className="px-4 pb-5 sm:px-6">
          <div className="flex items-end justify-between gap-3">
            <div className="-mt-12 rounded-full bg-background p-1">
              <Skeleton className="h-[92px] w-[92px] rounded-full" />
            </div>
            <Skeleton className="mb-1 h-9 w-28 rounded-full" />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="mt-3 h-8 w-44 rounded-full" />
          <Skeleton className="mt-3.5 h-4 w-56" />
        </div>
      </div>

      <Skeleton className="h-[74px] w-full rounded-2xl" />

      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full rounded-none" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    </div>
  );
}
