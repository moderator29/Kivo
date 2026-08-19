import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// /profile/season keeps the older ad-hoc column rather than ProfilePageShell's
// narrow one, so its skeleton matches that container and not the sibling
// profile pages'.
export default function ProfileSeasonLoading() {
  return (
    <PageSkeleton className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8" label="Loading your season">
      <div className="flex flex-col gap-1">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <Skeleton className="h-36 w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </PageSkeleton>
  );
}
