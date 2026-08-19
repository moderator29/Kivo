import type { ReactNode } from "react";
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { BackNavigationTracker } from "@/components/layout/back-navigation-tracker";
import { RouteBackLink } from "@/components/ui/back-link";

// Shared page chrome for the info/legal pages (about, privacy, terms): the
// same kivo-aurora-page background and header/footer structure as the
// landing page, so these read as the same product rather than a bolted-on
// afterthought, without ever needing to import from or edit
// src/app/page.tsx itself.
export function MarketingPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background">
      {/* Renders nothing — see src/hooks/use-in-app-history.ts. */}
      <BackNavigationTracker />
      <div className="kivo-aurora-page" aria-hidden="true">
        <span className="kivo-aurora-blob kivo-aurora-blob--cyan" />
        <span className="kivo-aurora-blob kivo-aurora-blob--violet" />
        <span className="kivo-aurora-blob kivo-aurora-blob--magenta" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex flex-1 flex-col">
          {/* The header above carries the KIVO mark, which is a link home and
              not a way back — somebody who opened the Terms from the sign-up
              form, or Get help from the sign-in screen, wants the screen they
              left, not the landing page. This returns them there, and falls
              back to the landing page when they arrived from outside KIVO. */}
          <div className="px-4 pt-2 sm:px-6 lg:px-12">
            <RouteBackLink tone="inline" />
          </div>
          {children}
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
