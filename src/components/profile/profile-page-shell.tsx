import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";

/**
 * The chrome every profile-editing page shares: a title, an optional line
 * saying what the page is for, then a single narrow column.
 *
 * These pages exist because the profile used to do all of this inline — a
 * background picker squeezed into a 5x2 strip of thumbnails, a bio hidden in
 * Settings, no way to change a club at all. Each of those is now its own
 * screen with room to show the choice at a size you can judge, and this shell
 * is what makes them feel like one flow rather than five pages that happen to
 * be next to each other.
 *
 * There is deliberately no back control here. Everything under `/profile/` is
 * a focus route (`isFocusRoute`, src/lib/route-class.ts — `/profile` itself is
 * the only tab), so the shell around it already renders exactly one way back,
 * and a second chevron immediately under the first is the thing that makes a
 * screen feel assembled rather than designed.
 *
 * `.kivo-page--narrow`, one step in from the profile's own width: a page with
 * a single decision on it should not stretch to the width of a content feed.
 * Both come from the shared `.kivo-page` container in globals.css, so these
 * screens keep the same margins and rhythm as everything else under (app)
 * rather than each inventing their own.
 */
export function ProfilePageShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="kivo-page kivo-page--narrow">
      <PageHeader title={title} description={description} />
      {children}
    </div>
  );
}
