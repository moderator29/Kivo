import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/fade-in";
import { getSettingsSection } from "@/lib/settings-sections";
import { cn } from "@/lib/utils";

/**
 * The frame every settings sub-page shares: a back link to the hub, the
 * section's own title and description straight out of SETTINGS_SECTIONS, and
 * one content column on the same rhythm as the rest of the app.
 *
 * A page and the row that opens it now say the same sentence, because they
 * read it from the same place.
 */
export function SettingsPageShell({ sectionId, children }: { sectionId: string; children: ReactNode }) {
  const section = getSettingsSection(sectionId);
  return (
    <div className="kivo-page">
      {/* No back link of its own: every settings page is a focus route, and
          the shell's own header (src/components/layout/focus-header.tsx)
          already puts one "‹ Settings" control at the top of the screen. Two
          back buttons on one page is worse than none. */}
      <PageHeader title={section.label} description={section.description} />
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

/**
 * One card inside a settings page. `title` is optional because several of the
 * panels this wraps render their own heading; the card is here to give a
 * control a container and a boundary, not to add a second title above it.
 */
export function SettingsCard({
  title,
  description,
  children,
  delay = 0,
  className,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <FadeIn delay={delay} className={cn("kivo-glass flex flex-col gap-3 rounded-2xl p-5", className)}>
      {title && (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="text-xs text-foreground-subtle">{description}</p>}
        </div>
      )}
      {children}
    </FadeIn>
  );
}

/**
 * A row that opens somewhere else. The chevron is real here — unlike the nav
 * drawer, where every row navigated and fourteen identical arrows said
 * nothing, these sit among controls that stay on the page, so the arrow is
 * what distinguishes "this opens" from "this toggles".
 */
export function SettingsLinkRow({
  href,
  label,
  description,
}: {
  href: string;
  label: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="kivo-focus -mx-2 flex min-h-14 items-center gap-3 rounded-xl px-2 transition-colors hover:bg-surface-2 focus-visible:ring-inset"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description && <span className="block text-xs text-foreground-subtle">{description}</span>}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-foreground-subtle/60" strokeWidth={1.75} />
    </Link>
  );
}
