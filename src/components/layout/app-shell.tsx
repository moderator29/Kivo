import type { ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { TopBar } from "./top-bar";
import { PageTransition } from "./page-transition";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen bg-background">
        <DesktopSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="flex flex-1 flex-col pb-20 lg:pb-0">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
        <MobileBottomNav />
      </div>
    </MotionConfig>
  );
}
