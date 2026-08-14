import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { TopBar } from "./top-bar";
import { OfflineBanner } from "./offline-banner";
import { PageTransition } from "./page-transition";
import { isAiConfigured } from "@/lib/ai/client";

export function AppShell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  const aiConfigured = isAiConfigured();

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen bg-background">
        <DesktopSidebar aiConfigured={aiConfigured} />
        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          <TopBar signedIn={signedIn} />
          <main className="flex flex-1 flex-col pb-20 lg:pb-0">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <MobileBottomNav aiConfigured={aiConfigured} />
      </div>
    </MotionConfig>
  );
}
