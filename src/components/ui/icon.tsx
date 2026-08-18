import type { LucideIcon, LucideProps } from "lucide-react";
import { ICON_SIZES, iconStrokeWidth, type IconSize } from "@/lib/design-system";
import { cn } from "@/lib/utils";

/**
 * The one place an icon's stroke weight is decided.
 *
 * KN-71: `strokeWidth` had spread across six different values in this
 * codebase, and item 278 proposed either a lint rule or a wrapper. Both, in
 * fact — a wrapper alone is a convention people have to remember, and a lint
 * rule alone leaves every call site restating a number it should never have
 * had to know. Together they make the scale in `src/lib/design-system.ts` the
 * only way to draw an icon: this component derives the weight from the size,
 * and `eslint-rules/icon-stroke-weight.mjs` catches anything that reaches past
 * it.
 *
 * Sizing is set as real `width`/`height` attributes rather than a Tailwind
 * `h-*`/`w-*` pair, because the weight and the size have to be decided
 * together — a size expressed in a class string is invisible to the code
 * picking the weight, which is exactly how the drift happened.
 *
 * Existing call sites that pass an explicit `strokeWidth` alongside an
 * `h-*` class are still valid and still linted; this is the preferred shape
 * for new code, not a migration mandate.
 */
export function Icon({
  icon: Component,
  size = "md",
  className,
  ...rest
}: {
  icon: LucideIcon;
  /** Named step on the scale. Defaults to `md` (16px), the app's workhorse. */
  size?: IconSize;
} & Omit<LucideProps, "size" | "strokeWidth" | "ref">) {
  const px = ICON_SIZES[size];
  return (
    <Component
      width={px}
      height={px}
      strokeWidth={iconStrokeWidth(px)}
      className={cn("shrink-0", className)}
      {...rest}
    />
  );
}
