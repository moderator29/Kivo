import { Skeleton } from "@/components/ui/skeleton";

// Matches NewsLoading's reasoning exactly: HighlightsPage renders a static
// <ComingSoon> with no data fetch, so this realistically never paints. It
// exists for consistency with every other route's loading state (item 284),
// and costs nothing when it does not show.
export default function HighlightsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-6 py-24 text-center">
      <Skeleton className="h-9 w-9 rounded-full" />
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}
