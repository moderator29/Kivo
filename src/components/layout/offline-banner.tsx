"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { WifiOff } from "lucide-react";

/**
 * Global "you're offline" banner (RECOMMENDATIONS.md item 100). Previously
 * only the AI chat (src/components/ai/chat.tsx) told a user their connection
 * dropped, and only after a failed fetch. This is ambient instead: driven by
 * `navigator.onLine` plus the `online`/`offline` window events, no polling,
 * so it appears the instant the browser notices the connection is gone and
 * disappears the instant it's back.
 *
 * `useSyncExternalStore` (rather than `useState` + `useEffect`) is the
 * React-recommended way to subscribe a component to a value that lives
 * outside React's own state — exactly what `navigator.onLine` is here — and
 * it has a dedicated server-snapshot argument for the SSR case, where
 * `navigator` doesn't exist at all: assume online there, exactly matching
 * this component's client-side value until the browser reports otherwise.
 */
function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  return true;
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <AnimatePresence initial={false}>
      {!online && (
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
            className="kivo-glass flex items-center justify-center gap-2 rounded-none border-x-0 border-t-0 px-4 py-2 text-xs font-medium text-foreground-muted"
          >
            <WifiOff className="h-3.5 w-3.5 shrink-0 text-critical" strokeWidth={2} />
            You&apos;re offline. Some things won&apos;t load until your connection comes back.
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
