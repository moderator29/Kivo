import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shape of the Match Centre, before it has one: hero, then the section
 * rail, then the panel. Same container geometry as the page itself
 * (`page-container.test.ts` enforces that), and the same three-block rhythm,
 * so nothing jumps when the real thing lands.
 */
export default function MatchDetailLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading this match">
      <div className="kivo-glass-brand flex flex-col gap-4 rounded-3xl p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4">
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
          <div className="flex min-w-[5.5rem] flex-col items-center gap-1.5 pt-1 sm:min-w-[7rem]">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-4 w-14 rounded-full" />
          </div>
          <div className="flex flex-col items-center gap-2">
            <Skeleton className="h-12 w-12 rounded-full" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        </div>
        <Skeleton className="mx-auto h-3 w-48" />
      </div>

      {/* The rail. Four cells of uneven width, because the real one sizes each
          section to its own label rather than dividing the screen. */}
      <div className="flex gap-4 border-b border-hairline pb-3">
        {["w-16", "w-20", "w-14", "w-12"].map((width) => (
          <Skeleton key={width} className={`h-4 ${width}`} />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    </PageSkeleton>
  );
}
