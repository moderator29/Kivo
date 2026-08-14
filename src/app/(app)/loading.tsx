import { Skeleton } from "@/components/ui/skeleton";

// Generic fallback for every (app) route that doesn't define its own
// loading.tsx (most already-specific pages like home/social/admin keep their
// own, closer-to-the-tree loading.tsx, which Next.js prefers over this one).
// Deliberately shaped like the common "heading + list of glass cards" layout
// most browse/detail pages under (app) share (teams, players, leagues,
// matches, predictions, transfers, live, news, rewards, profile, settings),
// rather than a fake progress bar implying specific, measurable progress.
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
