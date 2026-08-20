import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { hasAdminAccess, permittedAdminNavHrefs } from "@/lib/admin";
import { getSupportQueueSignal } from "@/lib/admin/support-signal";
import { getAuthUser } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";
import { SupportQueueBanner } from "@/components/admin/support-queue-banner";
import { BackNavigationTracker } from "@/components/layout/back-navigation-tracker";
import { RouteBackLink } from "@/components/ui/back-link";

// The nav list lives in src/lib/admin-nav.ts and is imported by the two client
// nav components directly. It must NOT come back here as a prop: a lucide icon
// is a function component, and passing one from this Server Component into a
// "use client" nav is a runtime serialization error that 500s every route under
// /admin. See that module's header for the full account.

// See src/app/(app)/layout.tsx for why this must be explicit rather than implied by
// the auth check alone.
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Resource-level auth boundary — see src/proxy.ts for why this isn't a middleware
  // matcher. getAuthUser() verifies the JWT's signature against Supabase's JWKS
  // rather than trusting the session cookie, and returns null both when nobody
  // is signed in and when auth isn't configured for this environment; either
  // way the only correct answer here is the sign-in page. This replaced Clerk's
  // auth.protect(), which threw rather than returning when middleware hadn't run.
  const user = await getAuthUser();
  if (!user) {
    redirect("/sign-in");
  }

  const profile = await getOrCreateProfile();

  // Server-side authorization is the real boundary — RLS backs this up at
  // the query layer, but the route itself must never rely on a client check.
  if (!profile || !hasAdminAccess(profile.role)) {
    redirect("/home");
  }

  // No `MotionConfig` here — the root layout (src/app/layout.tsx) already
  // provides one `reducedMotion="user"` for the whole tree, and that
  // setting reaches every `motion` component under it via context regardless
  // of DOM nesting depth. A second one here was redundant. RECOMMENDATIONS.md
  // item 74.
  // Which admin pages this role can actually use, as plain href strings —
  // resolved once here, server-side, against the same predicates the pages
  // themselves gate on. Strings cross the client boundary; the nav items
  // themselves cannot (see src/lib/admin-nav.ts). This hides links, it does
  // not replace any gate: every page still checks its own role and RLS still
  // backs that up.
  const permitted = permittedAdminNavHrefs(profile.role);

  // One extra read per full page load of any Admin route, and only for a role
  // that can actually see the queue — `getSupportQueueSignal` returns null
  // without querying otherwise, because an RLS-filtered zero here would render
  // as "nobody is locked out" (A3). This is the closest thing KIVO has to a
  // notification: the queue is the only route back in for a user whose sign-in
  // code never arrived, and until this it was visible on the Overview alone.
  // Its limits are real and are written down in that module's header.
  const supportSignal = await getSupportQueueSignal(profile.role);

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Renders nothing — see src/hooks/use-in-app-history.ts. */}
      <BackNavigationTracker />
      <AdminMobileNav permitted={permitted} supportSignal={supportSignal} />
      <AdminSidebar permitted={permitted} supportSignal={supportSignal} />
      <main className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-6 lg:px-10 lg:py-8">
        {/* /admin's own navigation is a sidebar at lg+ and a hamburger drawer
            below it, so on a phone every page under here was a screen you
            tapped into with nothing on it that points back out. One control,
            in the same place on every admin page: up to the Overview from a
            sub-page, out to KIVO from the Overview itself. */}
        <RouteBackLink tone="inline" />
        {/* Above the page, on every page. See the component for why it is not
            dismissible and why it hides itself on /admin/support. */}
        <SupportQueueBanner signal={supportSignal} />
        {children}
      </main>
    </div>
  );
}
