"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

// Enter-only, no `AnimatePresence`/exit animation: `mode="wait"` used to hold
// the incoming route offscreen until the outgoing one finished its 180ms
// exit, adding that delay to every single navigation on top of the RSC round
// trip — a real cost on the variable mobile connections this app is built
// for. The new route now animates straight in while the old one is removed
// immediately, same as the rest of the codebase's "reveal on arrival"
// pattern (FadeIn, etc). See RECOMMENDATIONS.md item 75.
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}
