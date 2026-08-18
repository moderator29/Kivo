import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getOrCreateProfile } from "@/lib/profile";
import { hasAdminAccess } from "@/lib/admin";
import { getAuthUser } from "@/lib/auth";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminMobileNav } from "@/components/admin/admin-mobile-nav";

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
  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <AdminMobileNav />
      <AdminSidebar />
      <main className="flex-1 px-4 py-6 lg:px-10 lg:py-8">{children}</main>
    </div>
  );
}
