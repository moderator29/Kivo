"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { isFocusRoute } from "@/lib/route-class";
import { MAIN_CONTENT_ID, SkipToContent } from "./route-focus";
import { FocusHeader } from "./focus-header";
import { cn } from "@/lib/utils";

/**
 * Decides how much chrome the current screen gets. See `src/lib/route-class.ts`
 * for the rule itself.
 *
 * Why the decision is made here, in one client component, rather than by
 * splitting `(app)` into `(tabs)`/`(focus)` route groups: route groups are the
 * textbook shape and were tried first. Moving seventeen route directories
 * rewrites every `@/app/(app)/<dir>/...` import across the codebase — sixty-odd
 * of them, in files owned by six other agents working in this same tree tonight
 * — and any one missed import is a build break, for a result the user cannot
 * tell apart from this. The chrome is a rendering concern, the auth gate is
 * not, and this keeps them separate: `(app)/layout.tsx` still resolves and
 * gates exactly once, above everything, and only what gets drawn around the
 * page changes here. Every URL in the product is untouched by construction,
 * because no file moved.
 *
 * `topBar`, `sidebar` and `bottomNav` arrive as already-rendered elements
 * rather than being imported here, so the async server work inside the top bar
 * (the notification fetch) stays on the server. The layout that produces them
 * is not re-rendered on a client navigation, so nothing is re-fetched when the
 * class changes — the elements are simply drawn or not.
 */
export function AppChrome({
  sidebar,
  topBar,
  bottomNav,
  banners,
  children,
}: {
  sidebar: ReactNode;
  topBar: ReactNode;
  bottomNav: ReactNode;
  /** Moderation and offline notices. Deliberately outside the top bar so they
   * survive on a focus route: "you are suspended" and "you are offline" are
   * exactly as true on the AI Copilot screen as on the feed, and a banner that
   * vanished when the chrome did would be a silent failure. */
  banners: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const focus = isFocusRoute(pathname);

  return (
    <>
      {/* The skip link only has something to skip when there is navigation
          above the content. On a focus route the first focusable thing already
          is the back button, one Tab from the top. */}
      {!focus && <SkipToContent />}

      {/* The sidebar stays at lg+ on both classes. On a phone a focus route is
          genuinely the whole screen, which is what was asked for; on a 1440px
          desktop, hiding the one persistent navigation the platform has would
          strand you on Settings with a single back button, and every desktop
          product that does this — Linear, Notion, X — keeps the rail and
          focuses the content pane. Same rule, honestly applied to two very
          different amounts of room. */}
      {sidebar}

      <div className="flex min-w-0 flex-1 flex-col">
        {banners}
        {focus ? <FocusHeader /> : topBar}

        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className={cn(
            "flex flex-1 flex-col focus:outline-none",
            // Only a tab route has to clear the floating bottom bar — and it
            // has to clear the home indicator underneath it too. The bar sits
            // at `env(safe-area-inset-bottom) + 12px` and is about 60px tall,
            // so a flat 6rem is enough on a flat-bottomed phone and about 10px
            // short on a notched one: the last row of every list on an iPhone
            // ends up under the bar. Adding the inset to the padding makes the
            // two follow the same number instead of one of them guessing.
            focus ? "pb-0" : "pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-0",
          )}
        >
          {/* Two different movements for two different meanings. A tab route
              arrives the way every other surface in this app arrives — a short
              rise into place. A focus route was pushed into from somewhere, so
              it comes in from the right, which is the direction the back button
              will send it away in. Motion saying where you are, not motion for
              its own sake. `<MotionConfig reducedMotion="user">` in the root
              layout downgrades both to an instant swap for anyone who asked. */}
          <motion.div
            key={pathname}
            initial={focus ? { opacity: 0, x: 20 } : { opacity: 0, y: 8 }}
            animate={focus ? { opacity: 1, x: 0 } : { opacity: 1, y: 0 }}
            transition={{ duration: focus ? 0.22 : 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-1 flex-col"
          >
            {children}
          </motion.div>
        </main>
      </div>

      {!focus && bottomNav}
    </>
  );
}
