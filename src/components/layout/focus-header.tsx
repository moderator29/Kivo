"use client";

import { useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { focusBackTarget } from "@/lib/route-class";

/**
 * The only chrome a focus route gets: one way back.
 *
 * `router.back()` first, because the point of this control is to return you to
 * the tab you left — with the scroll position you left it at, which Next
 * restores on a real history pop and cannot restore on a fresh push to the same
 * URL. The parent route is the fallback for the case history cannot serve: a
 * deep link, a notification, a bookmark, a shared URL, a fresh tab. A back
 * control that does nothing on first arrival is worse than no back control.
 *
 * The label names where you are going, not "Back" — you should be able to read
 * it and know whether pressing it is what you want.
 */
export function FocusHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const target = focusBackTarget(pathname);

  const goBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(target.href);
  }, [router, target.href]);

  return (
    <div className="sticky top-0 z-20 flex items-center gap-1 border-b border-hairline-soft bg-background/80 px-2 py-2 backdrop-blur-xl lg:px-6">
      <button
        type="button"
        onClick={goBack}
        className="kivo-focus flex min-h-11 items-center gap-0.5 rounded-full py-2 pl-1.5 pr-3.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 active:scale-95"
      >
        <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={1.75} />
        <span className="truncate">{target.label}</span>
      </button>
    </div>
  );
}
