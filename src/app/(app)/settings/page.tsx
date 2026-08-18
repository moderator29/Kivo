import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CircleUserRound } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { effectiveModerationStatus } from "@/lib/moderation";
import { ModerationStatusPanel } from "@/components/settings/moderation-status-panel";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/ui/fade-in";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from "@/lib/settings-sections";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

/**
 * Settings, as a map.
 *
 * This page used to render every settings panel in the product one after
 * another — eleven of them, each a card of identical weight, in one scroll
 * with no way to link anyone to a single control (KN-50, and the founder's own
 * example of what "jammed packed" means). It is now a list of rows, each
 * opening a real page.
 *
 * The one thing that stays inline is the moderation panel, and only when there
 * is genuinely something to say: a suspended or banned account needs to be
 * told on arrival, not behind a row it would have no reason to open.
 */
export default async function SettingsPage() {
  const profile = await getOrCreateProfile();

  if (!profile) {
    return (
      <div className="kivo-page kivo-page--narrow items-center text-center">
        <CircleUserRound className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} />
        <p className="text-sm text-foreground-muted">Sign up to manage your settings.</p>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime kivo-raise kivo-focus rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent"
        >
          Sign up
        </Link>
      </div>
    );
  }

  // Mirrors exactly what ModerationStatusPanel itself renders for
  // (suspended/banned only, lazy-expiry-adjusted) so an active or
  // shadow-muted account never renders an empty child into this column.
  const moderationStatus = effectiveModerationStatus(profile.moderation_status, profile.moderation_expires_at);
  const showModerationPanel = moderationStatus === "suspended" || moderationStatus === "banned";

  return (
    <div className="kivo-page">
      <PageHeader title="Settings" description={`Signed in as @${profile.username}.`} />

      {showModerationPanel && (
        <FadeIn delay={0.04}>
          <ModerationStatusPanel
            status={profile.moderation_status}
            reason={profile.moderation_reason}
            expiresAt={profile.moderation_expires_at}
          />
        </FadeIn>
      )}

      {SETTINGS_GROUPS.map((group, groupIndex) => {
        const sections = SETTINGS_SECTIONS.filter((section) => section.group === group.id);
        if (sections.length === 0) return null;
        return (
          <FadeIn key={group.id} delay={0.06 + groupIndex * 0.04} className="flex flex-col gap-2">
            <h2 className="px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground-subtle">
              {group.label}
            </h2>
            <ul
              className={cn(
                "kivo-glass flex flex-col rounded-2xl",
                group.id === "danger" && "border-critical/20",
              )}
            >
              {sections.map((section, index) => {
                const Icon = section.icon;
                return (
                  <li key={section.id} className={cn(index > 0 && "border-t border-hairline-soft")}>
                    <Link
                      href={section.href}
                      className="kivo-focus flex min-h-16 items-center gap-3.5 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:ring-inset"
                    >
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          group.id === "danger" ? "text-critical" : "text-foreground-subtle",
                        )}
                        strokeWidth={1.75}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-sm font-semibold",
                            group.id === "danger" ? "text-critical" : "text-foreground",
                          )}
                        >
                          {section.label}
                        </span>
                        <span className="block text-xs text-foreground-subtle">{section.description}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-foreground-subtle/60" strokeWidth={1.75} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </FadeIn>
        );
      })}
    </div>
  );
}
