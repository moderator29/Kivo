import Link from "next/link";
import { Compass } from "lucide-react";
import { CommandPalette } from "@/components/layout/command-palette";

// This is the app-wide catch-all: any URL that doesn't match a route at all
// (typos, dead links, bad bookmarks) lands here, outside the (app) shell —
// see src/app/(app)/not-found.tsx for the in-app-shell 404 that handles a
// mistyped id (e.g. /teams/[id]) on an otherwise-real route instead. Since
// there's no AppShell/TopBar here to supply the real ⌘K search trigger, this
// renders the same CommandPalette component standalone so a lost visitor
// isn't left with only "go back to Home" as an option.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
        <Compass className="h-8 w-8 text-on-accent" strokeWidth={1.75} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">Offside. This page doesn&apos;t exist.</h1>
        <p className="max-w-md text-sm text-foreground-muted">
          The page you&apos;re looking for isn&apos;t here. Search for a team, player or competition, or head back
          to the game.
        </p>
      </div>

      <div className="w-full max-w-md">
        <CommandPalette />
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
          href="/social"
          className="rounded-xl border border-hairline px-5 py-2.5 text-sm font-semibold text-foreground-muted transition hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Social
        </Link>
      </div>
    </div>
  );
}
