import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The competition page's shape, before it has any content.
 *
 * Sized to the real thing rather than approximately: the crest is the header's
 * 44px, the season rail is the same 44px tall, the tab rail sits on the same
 * hairline, and the table's rows are the table's rows. A skeleton whose
 * geometry differs from what replaces it produces a reflow at the exact moment
 * the reader starts reading, and that jolt is most of what makes a fast page
 * feel unfinished — the same reasoning `MatchListSkeleton` is built on.
 *
 * Ten rows, because a league table is long and a skeleton that stops after
 * three implies a short one is coming.
 */
export default function LeagueDetailLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading this competition">
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      </div>

      <div className="flex gap-2">
        {["w-20", "w-20", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-11 rounded-xl ${width}`} />
        ))}
      </div>

      <div className="flex gap-5 border-b border-hairline pb-3">
        {["w-11", "w-16", "w-14", "w-14"].map((width, i) => (
          <Skeleton key={i} className={`h-4 ${width}`} />
        ))}
      </div>

      <div className="kivo-glass overflow-hidden rounded-2xl">
        <div className="border-b border-hairline px-3 py-2">
          <Skeleton className="h-2.5 w-16" />
        </div>
        <div className="flex flex-col divide-y divide-hairline-soft">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2.5">
              <Skeleton className="h-3 w-5 shrink-0" />
              <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
              {/* Two name widths, alternating, so the block reads as a list of
                  different clubs rather than as a grid. */}
              <Skeleton className={`h-3.5 ${i % 2 === 0 ? "w-32" : "w-24"}`} />
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <Skeleton className="h-3 w-4" />
                <Skeleton className="h-3 w-6" />
                <Skeleton className="h-3.5 w-5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageSkeleton>
  );
}
