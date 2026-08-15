import type { ReactNode } from "react";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { TopBar } from "./top-bar";
import { OfflineBanner } from "./offline-banner";
import { PageTransition } from "./page-transition";
import { PreviewModeBanner } from "./preview-mode-banner";
import { isAiConfigured } from "@/lib/ai/client";

// No `MotionConfig` here — the root layout (src/app/layout.tsx) already
// wraps the whole tree in one `reducedMotion="user"` provider, and that
// setting reaches every `motion` component under it via context regardless
// of DOM nesting depth. A second one here was redundant. RECOMMENDATIONS.md
// item 74.
export type ViewerProfileSummary = { username: string; displayName: string | null; avatarUrl: string | null };

export function AppShell({
  children,
  signedIn,
  isAdmin,
  previewMode,
  viewerProfile,
}: {
  children: ReactNode;
  signedIn: boolean;
  /** Item 134: gates the /admin link in both nav surfaces. Computed
   * server-side in (app)/layout.tsx via hasAdminAccess(profile.role) —
   * always false for a guest, since there's no profile/role to check. */
  isAdmin: boolean;
  /** Admin-only, opt-in-only preview mode (src/lib/preview-mode.ts) —
   * computed server-side in (app)/layout.tsx, always false unless BOTH
   * isAdmin is true and the admin explicitly opted in. Drives the fixed
   * PreviewModeBanner plus the top padding that keeps it clear of content. */
  previewMode: boolean;
  /** Real profile summary for the mobile "More" sheet's header (avatar +
   * username) — null for a guest, in which case that header simply doesn't
   * render (see MobileBottomNav). Never fabricated placeholder identity. */
  viewerProfile: ViewerProfileSummary | null;
}) {
  const aiConfigured = isAiConfigured();

  return (
    <div className="relative flex min-h-screen bg-background" style={previewMode ? { paddingTop: 36 } : undefined}>
      {previewMode && <PreviewModeBanner />}
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
        <TopBar signedIn={signedIn} isAdmin={isAdmin} previewMode={previewMode} />
        <main className="flex flex-1 flex-col pb-24 lg:pb-0">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <MobileBottomNav aiConfigured={aiConfigured} isAdmin={isAdmin} viewerProfile={viewerProfile} />
    </div>
  );
}
