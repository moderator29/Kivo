import type { ReactNode } from "react";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { TopBar } from "./top-bar";
import { OfflineBanner } from "./offline-banner";
import { PageTransition } from "./page-transition";
import { isAiConfigured } from "@/lib/ai/client";

// No `MotionConfig` here — the root layout (src/app/layout.tsx) already
// wraps the whole tree in one `reducedMotion="user"` provider, and that
// setting reaches every `motion` component under it via context regardless
// of DOM nesting depth. A second one here was redundant. RECOMMENDATIONS.md
// item 74.
export function AppShell({
  children,
  signedIn,
  isAdmin,
}: {
  children: ReactNode;
  signedIn: boolean;
  /** Item 134: gates the /admin link in both nav surfaces. Computed
   * server-side in (app)/layout.tsx via hasAdminAccess(profile.role) —
   * always false for a guest, since there's no profile/role to check. */
  isAdmin: boolean;
}) {
  const aiConfigured = isAiConfigured();

  return (
    <div className="relative flex min-h-screen bg-background">
      {/* Much quieter than the landing page's aurora — app pages are
          information-dense, so this is just enough breathing motion behind
          the glass containers to not read as a static screen, never
          competing with real content for attention. */}
      <div className="kivo-aurora-ambient" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" style={{ opacity: 0.15 }} />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" style={{ opacity: 0.12 }} />
      </div>

      <DesktopSidebar aiConfigured={aiConfigured} isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <TopBar signedIn={signedIn} />
        <main className="flex flex-1 flex-col pb-24 lg:pb-0">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <MobileBottomNav aiConfigured={aiConfigured} isAdmin={isAdmin} />
    </div>
  );
}
