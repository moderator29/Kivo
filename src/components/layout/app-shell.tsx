import type { ReactNode } from "react";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { TopBar } from "./top-bar";
import { OfflineBanner } from "./offline-banner";
import { RouteFocus } from "./route-focus";
import { PreviewModeBanner } from "./preview-mode-banner";
import { ModerationBanner, type ModerationBannerInfo } from "./moderation-banner";
import { AppChrome } from "./app-chrome";
import { CommandPalette } from "./command-palette";
import { isAiConfigured } from "@/lib/ai/client";

// No `MotionConfig` here — the root layout (src/app/layout.tsx) already
// wraps the whole tree in one `reducedMotion="user"` provider, and that
// setting reaches every `motion` component under it via context regardless
// of DOM nesting depth. A second one here was redundant. RECOMMENDATIONS.md
// item 74.
export type ViewerProfileSummary = {
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  /** The real `profiles.bio`, or null when the user hasn't written one. The
   * nav drawer's identity block shows it, and shows a tappable "Add a bio"
   * prompt when it's null — never invented filler text. */
  bio: string | null;
};

export function AppShell({
  children,
  isAdmin,
  previewMode,
  viewerProfile,
  moderationBanner,
}: {
  children: ReactNode;
  /** Still accepted so (app)/layout.tsx's existing call site keeps compiling,
   * but deliberately not read any more: `viewerProfile` below is the single
   * source of "is someone signed in" now that the chrome renders KIVO's own
   * identity off a real profile. Two independent signals for one fact could
   * disagree; one cannot. */
  signedIn?: boolean;
  /** Item 134: gates the /admin link in both nav surfaces. Computed
   * server-side in (app)/layout.tsx via hasAdminAccess(profile.role) —
   * always false for a guest, since there's no profile/role to check. */
  isAdmin: boolean;
  /** Admin-only, opt-in-only (src/lib/preview-mode.ts) — computed
   * server-side in (app)/layout.tsx, always false unless BOTH isAdmin is
   * true and the admin explicitly opted in. Drives the fixed
   * PreviewModeBanner plus the top padding that keeps it clear of content. */
  previewMode: boolean;
  /** Real profile summary for the nav drawer's identity block and the bottom
   * bar's Profile tab — null for a guest, in which case neither renders.
   * Never fabricated placeholder identity. */
  viewerProfile: ViewerProfileSummary | null;
  /** RECOMMENDATIONS.md item 234: real, current suspended/banned state for
   * the signed-in viewer, computed server-side in (app)/layout.tsx from
   * their own profile row. Null for a guest, an active user, or a
   * shadow-muted one — this only ever renders for a genuine restriction on
   * the real viewer, never a placeholder or guess. */
  moderationBanner?: ModerationBannerInfo | null;
}) {
  const aiConfigured = isAiConfigured();

  return (
    <div className="relative flex min-h-screen bg-background" style={previewMode ? { paddingTop: 36 } : undefined}>
      <RouteFocus />
      {previewMode && <PreviewModeBanner />}
      {/* Much quieter than the landing page's aurora — app pages are
          information-dense, so this is just enough breathing motion behind
          the glass containers to not read as a static screen, never
          competing with real content for attention. */}
      <div className="kivo-aurora-ambient" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" style={{ opacity: 0.15 }} />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" style={{ opacity: 0.12 }} />
      </div>

      <AppChrome
        sidebar={<DesktopSidebar aiConfigured={aiConfigured} isAdmin={isAdmin} viewerProfile={viewerProfile} previewMode={previewMode} />}
        banners={
          <>
            {moderationBanner && <ModerationBanner info={moderationBanner} />}
            <OfflineBanner />
          </>
        }
        topBar={<TopBar viewer={viewerProfile} isAdmin={isAdmin} aiConfigured={aiConfigured} />}
        bottomNav={<MobileBottomNav viewerProfile={viewerProfile} />}
      >
        {children}
      </AppChrome>

      {/* Keyboard-only: no visible trigger anywhere in the chrome. Search's
          real home is /search, reachable from both nav shells; this is the ⌘K
          accelerator over the same action, mounted once for the whole app. */}
      <CommandPalette showTrigger={false} />
    </div>
  );
}
