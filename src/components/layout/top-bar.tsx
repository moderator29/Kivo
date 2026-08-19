import Link from "next/link";
import { Suspense } from "react";
import { Bell } from "lucide-react";
import type { ViewerProfileSummary } from "./app-shell";
import { getRecentNotifications } from "@/lib/notifications";
import { NotificationBell } from "./notification-bell";
import { NavDrawer } from "./nav-drawer";

/**
 * Static stand-in for the notification bell while its data streams in below —
 * same box size and icon as the real button's closed state, so nothing shifts
 * when it's replaced; the only visible change on resolve is the unread badge
 * (if any) popping in, same as any other "streams in when ready" affordance
 * elsewhere in the app.
 */
function NotificationBellFallback() {
  return (
    <div
      aria-hidden="true"
      className="flex h-9 w-9 items-center justify-center rounded-full text-foreground-muted"
    >
      <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </div>
  );
}

/**
 * The actual data fetch, isolated in its own async Server Component so it can
 * be wrapped in <Suspense> below — a Suspense boundary only suspends on an
 * async component within it, not on an await in its parent.
 */
async function NotificationBellData() {
  const { notifications, unreadCount } = await getRecentNotifications();
  return <NotificationBell initialNotifications={notifications} initialUnreadCount={unreadCount} />;
}

/**
 * The top bar, stripped back to what the founder actually asked for: a menu
 * button on the left and the notification bell on the right, and nothing in
 * between.
 *
 * What used to live here and where it went:
 *  - the search field  → /search, a real page (plus ⌘K, unchanged)
 *  - the account avatar → the bottom bar's Profile tab on mobile, the sidebar
 *    footer on desktop
 *  - the appearance toggle → the nav drawer's footer / the sidebar footer
 *  - the KIVO logo → the drawer header on mobile; the sidebar already carries
 *    it on desktop
 *
 * Each of those was a control competing for the same 44 pixels of the most
 * valuable strip on a phone. A top bar with two things in it reads as a
 * product; a top bar with six reads as a toolbar.
 */
export function TopBar({
  viewer,
  isAdmin = false,
  aiConfigured = false,
}: {
  /** The real signed-in profile, resolved server-side in (app)/layout.tsx —
   * null for a guest. Threaded down to the drawer for its account row; guest
   * vs signed-in is "is this null", so nothing can disagree about it. */
  viewer: ViewerProfileSummary | null;
  /** Gates the /admin entry inside the drawer's nav list. */
  isAdmin?: boolean;
  aiConfigured?: boolean;
}) {
  // The height comes from --kivo-header-h rather than falling out of whatever
  // the tallest child happens to be. That is what lets anything sticking
  // directly under this header (`<SectionTabs sticky>`) offset by the variable
  // and land exactly on the seam — measured, this bar was 65px on a phone
  // (the 44px drawer button) and 61px on a desktop (the 40px bell), so a
  // single guessed offset could not have been right on both. The vertical
  // padding goes with it: `items-center` inside a fixed height already
  // centres, and padding on top of a set height only fights it.
  return (
    <header className="sticky top-0 z-20 flex h-[var(--kivo-header-h)] items-center border-b border-hairline-soft bg-background/80 px-4 backdrop-blur-xl lg:px-8">
      {/* Founder's placement: top-left, where the logo used to sit. Hidden on
          desktop, where the sidebar is permanently open and a menu button
          would open a menu that is already on screen. */}
      <NavDrawer aiConfigured={aiConfigured} isAdmin={isAdmin} viewerProfile={viewer} />

      <div className="ml-auto flex items-center gap-1">
        {viewer ? (
          <Suspense fallback={<NotificationBellFallback />}>
            <NotificationBellData />
          </Suspense>
        ) : (
          <Link
            href="/sign-up"
            className="kivo-gradient-prime kivo-raise shrink-0 rounded-xl px-4 py-2 text-sm font-semibold text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Sign up
          </Link>
        )}
      </div>
    </header>
  );
}
