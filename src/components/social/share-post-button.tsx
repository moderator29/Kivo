"use client";

import { useState, useTransition } from "react";
import { motion } from "motion/react";
import { Check, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The permalink control a post never had.
 *
 * Directive section 3 asks for shareable, deep-linkable posts. The deep link
 * itself already existed and already worked — `/social?post=<id>` is the
 * contract `postHref()` in `lib/notification-registry.ts` produces and the
 * contract `/social` honours: the page fetches that exact post explicitly and
 * prepends it, so a link to a post buried forty pages down still lands on it.
 * What was missing was any way for a person to *get* that link. A post could
 * be reacted to, saved and reported, and not sent to anyone.
 *
 * Deliberately a link and not an image. The share cards elsewhere in KIVO turn
 * a row of verified football data into a picture; a post is somebody's own
 * writing, and rendering it into a KIVO-branded graphic would put KIVO's frame
 * around a stranger's words. The link is what is honest to share, and the
 * receiving reader gets the real post with its real author, reactions and
 * replies attached.
 *
 * The origin is read at click time rather than threaded down from the server:
 * this is the only place the value is needed, it is only needed in the
 * browser, and `window.location.origin` cannot be wrong about which host the
 * user is actually on — a server-rendered absolute URL can, and has been
 * before (see the fallback chain in `lib/site-url.ts`).
 */
export function SharePostButton({ postId }: { postId: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleShare() {
    setFailed(false);
    startTransition(async () => {
      const url = `${window.location.origin}/social?post=${postId}`;
      try {
        // Native share sheet first on the phones where most of this happens;
        // a cancelled sheet is a decision, not a failure, so it falls through
        // to nothing rather than to an error.
        if (navigator.share) {
          try {
            await navigator.share({ url, title: "KIVO" });
            return;
          } catch (error) {
            if (error instanceof Error && error.name === "AbortError") return;
          }
        }
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2400);
      } catch {
        // Clipboard access can be denied outright (insecure context, a
        // permissions policy). Saying so beats a button that does nothing.
        setFailed(true);
        window.setTimeout(() => setFailed(false), 3200);
      }
    });
  }

  return (
    <motion.button
      type="button"
      onClick={handleShare}
      disabled={pending}
      aria-label={copied ? "Link copied" : "Copy link to this post"}
      whileTap={{ scale: 0.88 }}
      className={cn(
        "flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        failed ? "text-critical" : copied ? "text-live" : "text-foreground-subtle hover:text-accent",
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : <Link2 className="h-3.5 w-3.5" strokeWidth={2} />}
      {failed ? "Couldn't copy" : copied ? "Copied" : "Share"}
    </motion.button>
  );
}
