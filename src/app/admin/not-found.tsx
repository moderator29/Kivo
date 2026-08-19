import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * A 404 inside /admin, without throwing the admin out of /admin.
 *
 * `not-found.tsx` renders inside its own segment's layout hierarchy, so
 * without this file a mistyped admin URL fell through to the root
 * `src/app/not-found.tsx` — which lives above `admin/layout.tsx` and therefore
 * lost the admin sidebar, the mobile drawer and every link back into the
 * section. An operator who fat-fingered a URL ended up on a page whose only
 * exits were into the consumer app.
 *
 * Same voice as the app's own 404, pointed at the section the reader is in.
 */
export default function AdminNotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div className="kivo-gradient-intelligence flex h-16 w-16 items-center justify-center rounded-2xl">
        <Compass className="h-8 w-8 text-on-accent" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-foreground">No admin page here.</h1>
        <p className="max-w-md text-sm text-foreground-muted">
          That URL isn&apos;t one of the admin tools. The nav lists every one of them.
        </p>
      </div>
      <Link
        href="/admin"
        className="kivo-gradient-prime kivo-raise rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Admin overview
      </Link>
    </div>
  );
}
