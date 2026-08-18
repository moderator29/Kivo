import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * A grouped list of rows inside one card — the shape iOS, Instagram and every
 * settings screen worth copying uses for "here are your fields, each opens its
 * own page".
 *
 * It exists to replace the pattern the founder rejected: every setting as its
 * own floating panel, stacked down one long scroll. A group is one card, the
 * rows are separated by a hairline, and the card says what the group is about
 * once instead of once per row.
 */
export function SettingRowGroup({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">{label}</h2>
      )}
      <div className="kivo-glass flex flex-col divide-y divide-hairline-soft overflow-hidden rounded-2xl">
        {children}
      </div>
    </div>
  );
}

/**
 * One row. `value` is the current setting shown on the right; when it is empty
 * the row falls back to `placeholder` in a quieter colour, so "you have not
 * written a bio" and "your bio is "…"" are visibly different states rather
 * than one blank space.
 */
export function SettingRow({
  href,
  label,
  value,
  placeholder,
  leading,
  trailing,
}: {
  href: string;
  label: string;
  value?: string | null;
  placeholder?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="kivo-focus flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-1"
    >
      {leading && <span className="flex shrink-0 items-center text-foreground-muted">{leading}</span>}
      <span className="shrink-0 text-sm font-medium text-foreground">{label}</span>
      {trailing ?? (
        <span
          className={`ml-auto min-w-0 truncate text-right text-sm ${
            value ? "text-foreground-muted" : "text-foreground-subtle"
          }`}
        >
          {value || placeholder}
        </span>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
    </Link>
  );
}
