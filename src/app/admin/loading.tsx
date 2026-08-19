import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shape every admin page actually loads in: a header, then a stack of
 * full-width panels. A skeleton whose geometry does not match its content is
 * worse than none — this used to draw a four-across stat grid, which no admin
 * page has rendered since the overview was rebuilt around an attention list.
 */
export default function AdminLoading() {
  return (
    <PageSkeleton className="flex flex-col gap-8" label="Loading the admin section">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    </PageSkeleton>
  );
}
