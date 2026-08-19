import { PageSkeleton } from "@/components/ui/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { SectionHeadingSkeleton, SectionTabsSkeleton } from "@/components/ui/skeletons";
import { MatchListSkeleton } from "@/components/matches/match-list";

/**
 * The club page's own geometry, drawn empty.
 *
 * Built from the shared skeleton family (`docs/UI_PRIMITIVES.md` §3) so the
 * pieces that are shared — the tab rail's 44px and its hairline, a section
 * heading, a fixture list's time rail — cannot drift from the components they
 * stand in for. Only the identity block is drawn by hand, because it is this
 * page's own shape: crest, name, and the position-and-form strip under it.
 *
 * A skeleton whose geometry differs from what replaces it produces a reflow at
 * the exact moment the reader starts reading, which is most of what makes a
 * fast page feel unfinished.
 */
export default function TeamDetailLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading this club">
      <div className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-9 w-20 shrink-0 rounded-xl" />
        </div>
        <div className="flex items-center gap-5 border-t border-hairline-soft pt-4">
          <Skeleton className="h-8 w-24" />
          <div className="flex gap-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-7 rounded-full" />
            ))}
          </div>
        </div>
      </div>

      {/* The rail is drawn without knowing how many tabs this club earns —
          five is the common case and the strip is the same height either way. */}
      <SectionTabsSkeleton tabs={5} />

      <div className="flex flex-col gap-3">
        <SectionHeadingSkeleton />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeadingSkeleton />
        <MatchListSkeleton rows={4} />
      </div>
    </PageSkeleton>
  );
}
