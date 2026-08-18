import { cn } from "@/lib/utils";

/**
 * Pending marker for a step that is in flight — a rotating ring of dashes.
 *
 * Used instead of a solid spinner wherever the thing being waited on is
 * *thought*, not transfer: an AI turn being composed, a plan being formed, a
 * multi-step job working through its list. The dashed ring reads as "still
 * forming" where a solid arc reads as "loading a file", and a column of them
 * in a task list stays calm because they all rotate at the same slow rate.
 *
 * Pure CSS (`.kivo-orb` in globals.css), so a list of twenty costs twenty
 * composited rotations and no extra DOM. Reduced motion stops the rotation
 * via the global clamp; the ring itself stays, so the state is still visible.
 */
export function ThinkingOrb({
  size = 14,
  variant = "dashed",
  className,
}: {
  size?: number;
  /** "solid" is the tighter, faster arc for genuine transfer waits. */
  variant?: "dashed" | "solid";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("kivo-orb shrink-0", variant === "solid" && "kivo-orb--solid", className)}
    />
  );
}

/**
 * A labelled in-progress row: orb plus status text, as a live region so the
 * label is announced when it changes. The orb itself is decorative — the text
 * carries the meaning.
 */
export function ThinkingLine({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn("flex items-center gap-2 text-xs text-foreground-subtle", className)}
    >
      <ThinkingOrb />
      {label}
    </span>
  );
}
