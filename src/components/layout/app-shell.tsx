import type { ReactNode } from "react";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { TopBar } from "./top-bar";
import { OfflineBanner } from "./offline-banner";
import { PageTransition } from "./page-transition";
import { MAIN_CONTENT_ID, RouteFocus, SkipToContent } from "./route-focus";
import { PreviewModeBanner } from "./preview-mode-banner";
import { ModerationBanner, type ModerationBannerInfo } from "./moderation-banner";
import { isAiConfigured } from "@/lib/ai/client";

// No `MotionConfig` here — the root layout (src/app/layout.tsx) already
// wraps the whole tree in one `reducedMotion="user"` provider, and that
// setting reaches every `motion` component under it via context regardless
// of DOM nesting depth. A second one here was redundant. RECOMMENDATIONS.md
// item 74.
export type ViewerProfileSummary = { username: string; displayName: string | null; avatarUrl: string | null };

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
   * source of "is someone signed in" now that the top bar renders KIVO's own
   * account menu off a real profile rather than Clerk's self-fetching
   * `<UserButton>`. Two independent signals for one fact could disagree; one
   * cannot. */
  signedIn?: boolean;
  /** Item 134: gates the /admin link in both nav surfaces. Computed
   * server-side in (app)/layout.tsx via hasAdminAccess(profile.role) —
   * always false for a guest, since there's no profile/role to check. */
  isAdmin: boolean;
  /** Admin-only, opt-in-only preview mode (src/lib/preview-mode.ts) —
   * computed server-side in (app)/layout.tsx, always false unless BOTH
   * isAdmin is true and the admin explicitly opted in. Drives the fixed
   * PreviewModeBanner plus the top padding that keeps it clear of content. */
  previewMode: boolean;
  /** Real profile summary for the mobile "More" sheet's header and the top
   * bar's account menu (avatar + username) — null for a guest, in which case
   * neither renders (see MobileBottomNav, TopBar). Never fabricated
   * placeholder identity. */
  viewerProfile: ViewerProfileSummary | null;
  /** RECOMMENDATIONS.md item 234: real, current suspended/banned state for
   * the signed-in viewer, computed server-side in (app)/layout.tsx from
   * their own profile row. Null for a guest, an active user, or a
   * shadow-muted one (shadow-mute is deliberately zero-friction to the
   * muted user themselves) — this only ever renders for a genuine
   * restriction on the real viewer, never a placeholder or guess. */
  moderationBanner?: ModerationBannerInfo | null;
}) {
  const aiConfigured = isAiConfigured();

  return (
    <div className="relative flex min-h-screen bg-background" style={previewMode ? { paddingTop: 36 } : undefined}>
      {/* KN-78 / RECOMMENDATIONS item 275. First focusable thing in the shell,
          so one Tab from the top of any page skips the whole nav. */}
      <SkipToContent />
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

      <DesktopSidebar aiConfigured={aiConfigured} isAdmin={isAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        {moderationBanner && <ModerationBanner info={moderationBanner} />}
        <OfflineBanner />
        <TopBar viewer={viewerProfile} isAdmin={isAdmin} previewMode={previewMode} />
        {/* tabIndex={-1} makes <main> a programmatic focus target without
            adding it to the tab order; RouteFocus moves focus here after every
            client-side navigation, and the skip link points at it. The outline
            is suppressed because the focus is programmatic — the user did not
            tab to this container, and a full-page ring on every navigation
            reads as a rendering fault rather than as guidance. */}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex flex-1 flex-col pb-24 focus:outline-none lg:pb-0"
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <MobileBottomNav aiConfigured={aiConfigured} isAdmin={isAdmin} viewerProfile={viewerProfile} />
    </div>
  );
}
