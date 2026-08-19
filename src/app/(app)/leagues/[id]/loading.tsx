import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionTabsSkeleton, TableSkeleton } from "@/components/ui/skeletons";

/**
 * The competition page's shape, before it has any content.
 *
 * The rail and the table come from the shared skeleton family
 * (docs/UI_PRIMITIVES.md), so their geometry cannot drift from the components
 * they stand in for — a skeleton whose shape differs from what replaces it
 * produces a reflow at the exact moment the reader starts reading, and that
 * jolt is most of what makes a fast page feel unfinished.
 *
 * The header block is local because a competition's header is not the app's
 * `PageHeader`: it carries a crest and a follow control, and skeletoning the
 * plain one would move the title 56px sideways on arrival.
 *
 * Six numeric columns, counted on the real table at this page's width: P, W,
 * D, L, GD and Pts. Goals for and against are not among them — they need a
 * container wider than this page has, see `COLUMN_TIER` in the standings
 * table.
 */
export default function LeagueDetailLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading this competition">
      <div className="flex items-center gap-3" aria-hidden="true">
        <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
      </div>

      {/* The season rail. Same 44px targets as the real links. */}
      <div className="flex gap-2" aria-hidden="true">
        {["w-20", "w-20", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-11 rounded-xl ${width}`} />
        ))}
      </div>

      <SectionTabsSkeleton tabs={5} />

      <TableSkeleton rows={10} columns={6} />
    </PageSkeleton>
  );
}
