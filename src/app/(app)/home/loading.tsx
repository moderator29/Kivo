import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeadingSkeleton } from "@/components/ui/skeletons";
import { MatchListSkeleton } from "@/components/matches/match-list";

/**
 * /home's skeleton.
 *
 * A skeleton must share the *exact* geometry of what replaces it, so a load
 * never ends in a reflow — and on the first screen after sign-in a reflow is
 * the first thing anybody sees the product do. Every measurement below is
 * taken from the real page rather than eyeballed:
 *
 *   container   `.kivo-page`, the same class HomePage renders into (enforced
 *               by src/lib/page-container.test.ts)
 *   greeting    a 20px line over the 32px `text-2xl` title, `gap-0.5`
 *   lead        `rounded-3xl p-6`, chip row → 44px crests with a name under
 *               each → 44px action buttons → the reason line
 *   rail        44px pills, the same three-then-cut-off shape
 *   sections    `<SectionHeadingSkeleton>` over the shared
 *               `<MatchListSkeleton>` — the same rows the real list draws
 *
 * The section stack is deliberately fixture-shaped. The ladder cannot be
 * predicted before the data lands, but the *most common* first section on a
 * populated home is a fixture list, and on an empty one nothing renders here
 * at all — so match rows are the shape that is right most often and wrong
 * least badly.
 *
 * The lead's own heading is not skeletoned: its title is static, and a heading
 * that flickers from grey bar to text on every load is noisier than one that
 * never moved.
 */
function LeadSideSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <Skeleton className="h-11 w-11 rounded-full" />
      <Skeleton className="h-4 w-20" />
    </div>
  );
}

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeadingSkeleton action />
      <MatchListSkeleton rows={rows} />
    </div>
  );
}

export default function HomeLoading() {
  return (
    <PageSkeleton label="Loading your football">
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-8 w-64" />
      </div>

      <div className="kivo-glass flex flex-col gap-4 rounded-3xl p-6 sm:p-7">
        <Skeleton className="h-6 w-24 rounded-md" />
        <div className="flex items-start justify-center gap-2">
          <LeadSideSkeleton />
          <div className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 pt-2 sm:w-28">
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-3.5 w-24" />
          </div>
          <LeadSideSkeleton />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {/* `w-full sm:flex-1`, never `flex-1` on its own: inside a column
              flexbox `flex-1` sets `flex-basis: 0%`, which collapses a bar that
              has a height but no content to hold it open. The real buttons
              survive it because their `min-h-11` does that job. */}
          <Skeleton className="h-11 w-full rounded-xl sm:flex-1" />
          <Skeleton className="h-11 w-full rounded-xl sm:flex-1" />
        </div>
        <Skeleton className="h-3.5 w-44" />
      </div>

      <div className="flex gap-2">
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-32 rounded-full" />
        <Skeleton className="h-11 w-24 rounded-full" />
      </div>

      <SectionSkeleton rows={4} />
      <SectionSkeleton rows={3} />
    </PageSkeleton>
  );
}
