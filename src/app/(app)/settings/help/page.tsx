import type { Metadata } from "next";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";

export const metadata: Metadata = { title: getSettingsSection("help").label };

/** KN-55: /support (migration 0055) is reachable from the sign-in screen and
 * the marketing footer — the two places a signed-in user never looks. This is
 * the entry point from inside the app, and it names the real topics rather
 * than dumping everyone into one box. */
export default function HelpSettingsPage() {
  return (
    <SettingsPageShell sectionId="help">
      <SettingsCard>
        <p className="text-sm text-foreground-muted">
          Something broken, a score that looks wrong, or anything else — a person reads every one of these.
        </p>
        <div className="flex flex-col gap-2">
          {[
            { href: "/support?topic=bug", label: "Report a bug" },
            { href: "/support?topic=data_correction", label: "Football data looks wrong" },
            { href: "/support", label: "Something else" },
          ].map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="kivo-focus flex min-h-12 items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <LifeBuoy className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
              {entry.label}
            </Link>
          ))}
        </div>
      </SettingsCard>
    </SettingsPageShell>
  );
}
