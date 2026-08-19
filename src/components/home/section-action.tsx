import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * The "see all" control on a `<Section>` heading row.
 *
 * `<Section>`'s `action` slot takes any node, which is right — a season picker
 * and a link are not the same control. Home uses the same link eight times
 * over, so it is a component rather than eight copies of a class string, and
 * it is the pattern any other surface should copy for the same job.
 *
 * `-mr-1.5` pulls the glyph back to the section's optical edge while the tap
 * target keeps its full 44px, which is the only reason the padding looks
 * lopsided.
 */
export function SectionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="kivo-focus -mr-1.5 flex min-h-11 items-center gap-0.5 rounded-lg pl-2 pr-1 text-xs font-medium text-foreground-muted transition-colors hover:text-foreground"
    >
      {label}
      <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
    </Link>
  );
}
