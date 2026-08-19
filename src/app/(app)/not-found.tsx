import Link from "next/link";
import { Compass } from "lucide-react";

// Placed at the (app) route group root so a notFound() call from any page
// under it (e.g. /teams/[id], /players/[id], /leagues/[id], /matches/[id]
// hitting a mistyped or deleted id) renders here instead of falling through
// to the root-level src/app/not-found.tsx. Per the component hierarchy,
// not-found.js is wrapped by loading.js and error.js in the same segment but
// does NOT replace src/app/(app)/layout.tsx — so the AppShell (sidebar nav,
// top bar with its search, bottom nav) keeps rendering around this
// fallback, keeping the user inside the app instead of ejecting them to a
// bare page. That's also why there's no need to surface a search trigger
// here the way the root 404 does: the real one is already on screen.
export default function AppNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
        <Compass className="h-8 w-8 text-on-accent" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Offside. That doesn&apos;t exist.</h1>
        <p className="max-w-md text-sm text-foreground-muted">
          Whatever you were looking for isn&apos;t here, or it might have moved. Try search, or
          pick somewhere to go.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/home"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Back to Home
        </Link>
        <Link
          href="/matches"
          className="rounded-xl border border-hairline px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Matches
        </Link>
        <Link
          href="/teams"
          className="rounded-xl border border-hairline px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Teams
        </Link>
      </div>
    </div>
  );
}
