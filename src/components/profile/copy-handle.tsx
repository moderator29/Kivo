"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The handle, with a one-tap copy of the profile it belongs to.
 *
 * The reference this borrows from copies a wallet address, which is the only
 * thing on that screen anybody needs to send someone. KIVO's equivalent of
 * "the string you paste to another person" is the profile URL — mentions do
 * not exist in this product, so copying "@tayo" would hand the user a string
 * with nowhere to put it.
 *
 * The origin is read from `window.location` rather than from a configured site
 * URL: this only ever runs after a click, in the browser the user is actually
 * on, so it cannot copy a link to an environment they are not looking at.
 *
 * Fails visibly, not silently. `navigator.clipboard` is unavailable on an
 * insecure origin and can be refused by permission policy; when it throws, the
 * handle stays a handle and the label says so rather than showing a tick that
 * copied nothing.
 */
export function CopyHandle({ username, className }: { username: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timeout = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timeout);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/u/${username}`);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy the link to @${username}`}
      className={cn(
        "kivo-focus group flex w-fit max-w-full items-center gap-1.5 rounded-lg py-0.5 text-sm text-foreground-subtle transition-colors hover:text-foreground-muted",
        className,
      )}
    >
      <span className="truncate">@{username}</span>
      {state === "copied" ? (
        <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-live">
          <Check className="h-3 w-3" strokeWidth={2} />
          Link copied
        </span>
      ) : state === "failed" ? (
        <span className="shrink-0 text-[11px] font-semibold text-foreground-subtle">Copy blocked</span>
      ) : (
        <Copy
          // Visible at rest, not on hover: there is no hover on a phone, and
          // an affordance a thumb cannot discover is not an affordance.
          className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
          strokeWidth={2}
        />
      )}
    </button>
  );
}
