"use client";

import { AnimatePresence, motion } from "motion/react";
import { WifiOff, CloudOff } from "lucide-react";
import { useNetworkState } from "@/lib/network-state";

/**
 * Ambient network state (RECOMMENDATIONS item 100, extended by KN-79).
 *
 * The original reflected `navigator.onLine` and nothing else, which covers the
 * least common of the three real cases. It now also surfaces the one that
 * actually happens on a variable mobile connection: the browser believes it is
 * online, and a request KIVO genuinely made did not complete.
 *
 * That second state is never inferred — `src/lib/network-state.ts` only sets it
 * when a real server action failed at the transport layer, and clears it the
 * moment anything succeeds. A banner that guessed at connection quality would
 * be exactly the kind of unearned claim this product does not make.
 *
 * The two states get different words and different icons on purpose. "You're
 * offline" is a statement about the user's connection; "we couldn't reach
 * KIVO" is a statement about ours, and honestly might be our fault.
 *
 * The filename and the exported name are unchanged on purpose: `app-shell.tsx`
 * is owned by another workstream right now, and a behaviour upgrade should not
 * require a rename in a file someone else is restructuring.
 */
export function OfflineBanner() {
  const state = useNetworkState();

  return (
    <AnimatePresence initial={false}>
      {state !== "online" && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div
            role="status"
            aria-live="polite"
            className="kivo-glass flex items-center justify-center gap-2 rounded-none border-x-0 border-t-0 px-4 py-2 text-center text-xs font-medium text-foreground-muted"
          >
            {state === "offline" ? (
              <>
                <WifiOff className="h-3.5 w-3.5 shrink-0 text-critical" strokeWidth={2} aria-hidden="true" />
                You&apos;re offline. Some things won&apos;t load until your connection comes back.
              </>
            ) : (
              <>
                <CloudOff className="h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2} aria-hidden="true" />
                We couldn&apos;t reach KIVO. Your last action didn&apos;t go through - try it again.
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
