"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

function subscribeToNothing() {
  return () => {};
}

/**
 * Renders its children into `<body>`.
 *
 * This exists because of one CSS rule that bites twice in this app: an
 * ancestor with a `transform`, `filter` or `backdrop-filter` becomes the
 * containing block for `position: fixed` descendants. KIVO's top bar is
 * `backdrop-blur-xl` and every page body sits inside a `motion.div` that
 * animates `x`/`y`, so a "fixed to the viewport" element declared inside
 * either one is really fixed to a 52px header or to a page-height box — which
 * is how a bottom-right floating button ends up under the page title.
 *
 * Anything that means the *viewport* — an overlay, a drawer, a floating action
 * button — goes through here.
 *
 * "Are we in the browser yet" is read as an external fact via
 * `useSyncExternalStore` (no-op subscribe, since there is nothing to listen
 * for) rather than an effect that sets a mounted flag, which is the
 * derived-state anti-pattern this codebase's lint rules reject.
 */
export function ViewportPortal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
