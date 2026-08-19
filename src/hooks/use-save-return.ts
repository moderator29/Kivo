"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCanGoBack } from "@/hooks/use-in-app-history";
import { backTargetFor } from "@/lib/route-class";

/**
 * How long "Saved" stays on screen before the form returns the user to where
 * they came from.
 *
 * Not zero, and the reason is not decoration. A save that navigates the
 * instant the server answers gives the user no evidence it worked — the form
 * is simply gone, and "did that save?" is the question the whole confirmation
 * state exists to answer. Long enough to read one word, short enough that
 * nobody waits for it.
 */
export const SAVE_RETURN_DELAY_MS = 700;

/**
 * "When I click save it should auto save and take me back to the previous
 * page, not that go back button." — the founder, about every form in Settings
 * and the profile.
 *
 * The complaint was not about the back control; it was that saving left you
 * standing on a form you had finished with, and the only way out was to press
 * something else. So this is the return, and the back control stays exactly
 * where it is — a user who changes their mind mid-form still needs a way out
 * that does not save.
 *
 * WHERE "BACK" GOES, AND WHY IT MATCHES THE CHEVRON
 * -------------------------------------------------
 * Identical logic to `BackLink` (src/components/ui/back-link.tsx), deliberately
 * and not by coincidence:
 *
 * - With a KIVO page genuinely behind this one, `router.back()` — so the user
 *   lands on the exact list, tab and scroll position they left. Next restores
 *   scroll on a real history pop and cannot restore it on a fresh push to the
 *   same URL, so this is a real difference rather than a nicety.
 * - Otherwise a push to `backTargetFor(pathname)`, the same parent surface the
 *   chevron names. A form opened from a notification, a deep link or a fresh
 *   tab has nothing behind it, and `history.back()` there would leave KIVO
 *   entirely — which is exactly what `useCanGoBack` exists to prevent.
 *
 * Two controls that claim to go "back" must not disagree about where back is,
 * and the way to guarantee that is for both to ask the same two questions in
 * the same order.
 */
export function useSaveReturn(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  const canGoBack = useCanGoBack();
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A form can be unmounted by something else (a signed-out redirect, a
  // parent re-render) inside the confirmation window; navigating from a timer
  // that outlived its component is how a user ends up somewhere they did not
  // ask to be.
  useEffect(() => {
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, []);

  return useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      if (canGoBack) router.back();
      else router.push(backTargetFor(pathname).href);
    }, SAVE_RETURN_DELAY_MS);
  }, [canGoBack, pathname, router]);
}
