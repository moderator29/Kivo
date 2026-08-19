"use client";

import { useCallback, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RotateCw } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { cn } from "@/lib/utils";

/**
 * The fourth state. Not "there is nothing", but "we could not find out".
 *
 * `<NoDataYet>` sits next to this one and says something quite specific: that
 * KIVO builds its football coverage one competition at a time, that this
 * section is empty because it has not been synced yet, and — in as many words
 * — that nothing is broken. That is a good, honest sentence, and it is a lie
 * every time it is shown because a query failed rather than because a table is
 * empty. The two facts were indistinguishable on screen; this is the screen
 * that tells them apart.
 *
 * Three things it does that an empty state must not:
 *
 * - It says the read failed, in the user's terms, without a stack trace and
 *   without blaming their connection when KIVO does not know whose fault it
 *   was.
 * - It offers a retry that actually re-runs the server render
 *   (`router.refresh()`), which is the real recovery for a transient read —
 *   not a link somewhere else, and not an instruction to reload the page.
 * - It is announced. `role="status"` with `aria-live="polite"`, because after
 *   a retry the outcome changes in place and a screen reader user gets no
 *   navigation event to tell them so.
 *
 * `NoDataYet`'s coverage explainer is deliberately absent — pointing somebody
 * at /transparency to see "exactly what KIVO has" would be answering a
 * question they did not ask with a page that cannot help.
 */
export function LoadFailed({
  /** What could not be read, in the product's own words: "Teams", "Your
   * notifications", "This club's squad". Becomes the heading. */
  title,
  /** One line naming what is missing and what a retry will do. Optional —
   * the default covers the ordinary case. */
  description,
  /** Pre-rendered vector icon, same calling convention as `NoDataYet`. */
  icon,
  /** `page` fills the surface, for when the failed read *is* the page.
   * `section` is a card, for one panel failing beside content that loaded. */
  tone = "page",
  className,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  tone?: "page" | "section";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Tracked separately from `pending` so the label can say "Still not loading"
  // rather than silently flashing back to the same screen on a second failure.
  const [attempts, setAttempts] = useState(0);

  const retry = useCallback(() => {
    setAttempts((n) => n + 1);
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const body =
    description ??
    "KIVO couldn't reach its data just now, so this is empty for a reason that has nothing to do with what's in it. Nothing has been lost — try again.";

  return (
    <FadeIn
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center gap-4 text-center",
        tone === "page"
          ? "flex-1 justify-center px-6 py-16"
          : "kivo-glass rounded-2xl px-5 py-8",
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-1 text-foreground-subtle">
        {icon ?? <CloudOff className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />}
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 className={cn("font-semibold text-foreground", tone === "page" ? "text-base" : "text-sm")}>
          {title} didn&apos;t load.
        </h2>
        <p className="max-w-xs text-sm text-foreground-muted">{body}</p>
      </div>

      <button
        type="button"
        onClick={retry}
        disabled={pending}
        aria-busy={pending}
        className="kivo-glass-sharp kivo-focus inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-foreground transition-colors duration-150 disabled:opacity-60 motion-reduce:transition-none"
      >
        <RotateCw
          className={cn("h-4 w-4", pending && "motion-safe:animate-spin")}
          strokeWidth={2}
          aria-hidden="true"
        />
        {pending ? "Trying…" : attempts > 0 ? "Try once more" : "Try again"}
      </button>

      {/* Only after a retry has already failed. Offering the support route
          before that would read as KIVO expecting to fail. */}
      {attempts > 1 && !pending && (
        <p className="text-xs text-foreground-subtle">
          Still not loading? It&apos;s on KIVO&apos;s side, not yours —{" "}
          <a
            href="/support?topic=bug"
            className="kivo-focus rounded font-medium text-accent transition-colors hover:text-foreground"
          >
            tell us
          </a>
          .
        </p>
      )}
    </FadeIn>
  );
}
