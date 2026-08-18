"use client";

import { AlertCircle, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * An error the user can actually do something about (KN-56).
 *
 * KIVO catches its failures properly — every mutation returns `{ error }` and
 * every call site surfaces it. What none of them offered was a way *out*: the
 * pattern below the route-level error boundary was a red string, and the user's
 * only recourse was to perform the gesture again from memory and hope. That is
 * the difference between an app that reports failure and one that recovers from
 * it, and it matters most on exactly the failure this product will hit most
 * often — a phone that dropped its connection mid-tap.
 *
 * The retry is always the *same server action* the component already ran, so
 * this is a shared shape rather than shared logic: the caller keeps its own
 * closure over what to redo, and this owns the wording, the affordance and the
 * announcement. Deliberately one component and not four, so "it failed, try
 * again" cannot end up phrased four different ways.
 *
 * `role="alert"` rather than a polite status: a failed action is an
 * interruption, and the retry control has to be discoverable to a screen reader
 * user at the moment it appears, not on their next sweep of the page.
 */
export function RetryableError({
  message,
  onRetry,
  retrying = false,
  className,
  size = "sm",
}: {
  message: string;
  /** Redo the exact action that failed. Omit for a failure with nothing to
   * retry — the message then renders alone rather than offering a button that
   * would do nothing. */
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
  /** `xs` for dense inline spots (a poll footer, a reaction row); `sm`
   * everywhere else. */
  size?: "xs" | "sm";
}) {
  const text = size === "xs" ? "text-[11px]" : "text-xs";

  return (
    <div role="alert" className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", text, className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-critical">
        <AlertCircle className={size === "xs" ? "h-3 w-3 shrink-0" : "h-3.5 w-3.5 shrink-0"} strokeWidth={2} />
        <span className="min-w-0">{message}</span>
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-busy={retrying}
          className="inline-flex shrink-0 items-center gap-1 font-semibold text-accent transition-colors hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60"
        >
          <RotateCw
            className={cn(size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5", retrying && "animate-spin")}
            strokeWidth={2}
          />
          {retrying ? "Retrying…" : "Try again"}
        </button>
      )}
    </div>
  );
}
