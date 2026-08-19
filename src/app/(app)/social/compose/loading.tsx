import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

// The composer is a focus route with no chrome but the back control, so a
// wrongly shaped skeleton here is the entire screen moving.
export default function ComposeLoading() {
  return (
    <PageSkeleton label="Loading the composer">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-5 w-64" />
      </div>

      <div className="flex flex-col gap-5">
        {/* Post / Poll switch, then avatar beside the writing area. */}
        <Skeleton className="h-9 w-28 rounded-full" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <Skeleton className="h-40 flex-1 rounded-2xl" />
        </div>
        <Skeleton className="ml-auto h-11 w-28 rounded-xl" />
      </div>
    </PageSkeleton>
  );
}
