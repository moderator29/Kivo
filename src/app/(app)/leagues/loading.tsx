import { PageSkeleton } from "@/components/ui/page-skeleton";
import { ListSkeleton, PageHeaderSkeleton } from "@/components/ui/skeletons";

/**
 * FRONTEND SWEEP: this drew six stacked `kivo-glass-sharp` cards. The list it
 * stands in for became one `<ListSurface>` with hairline-divided rows, so every
 * load of /leagues ended in six boxes collapsing into one panel — the exact
 * reflow the skeleton contract exists to prevent, and invisible in review
 * because a skeleton and its page are never on screen together.
 *
 * The header bars were wrong too: `h-6`/`h-4` against `<PageHeader>`'s real
 * `text-2xl`/`text-sm` line boxes of 32px and 20px. Eight pixels of nudge on
 * every arrival, on five browse pages that all made the same mistake.
 */
export default function LeaguesLoading() {
  return (
    <PageSkeleton className="kivo-page" label="Loading Leagues">
      <PageHeaderSkeleton titleWidth="w-28" />
      <ListSkeleton rows={6} leading="square" subtitle />
    </PageSkeleton>
  );
}
