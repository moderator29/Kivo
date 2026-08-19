import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Info,
  LayoutDashboard,
  OctagonAlert,
} from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { permittedAdminNavHrefs } from "@/lib/admin";
import { getAdminAttention, type AttentionItem, type AttentionLevel } from "@/lib/admin/attention";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-nav";
import { FadeIn } from "@/components/ui/fade-in";
import { staggerDelay } from "@/lib/stagger";
import { AdminPageHeader, AdminSection } from "@/components/admin/admin-chrome";

/**
 * The Admin overview — a list of things to decide, not a list of things to know.
 *
 * ADMIN IA PASS 2026-08-19. What was here before: four stat cards (total users,
 * total posts, pending reports, a "Live" pill for the provider) and a paragraph
 * of prose asserting which features were live. See the header of
 * `src/lib/admin/attention.ts` for why all three of those were wrong, and what
 * each item on this page is derived from instead.
 *
 * The second half is a directory of the section, because a nine-page admin tool
 * whose only map is a sidebar is a nine-page admin tool where six pages are
 * never opened. Each card carries the one line that says what its page is for.
 */

const LEVEL_STYLE: Record<AttentionLevel, { icon: typeof AlertTriangle; ring: string; tint: string; text: string }> = {
  critical: {
    icon: OctagonAlert,
    ring: "border-critical/40",
    tint: "bg-critical/10",
    text: "text-critical",
  },
  warning: {
    icon: AlertTriangle,
    ring: "border-warning/40",
    tint: "bg-warning/10",
    text: "text-warning",
  },
  unknown: {
    icon: CircleHelp,
    ring: "border-hairline",
    tint: "bg-surface-2",
    text: "text-foreground-muted",
  },
  info: {
    icon: Info,
    ring: "border-hairline",
    tint: "bg-surface-2",
    text: "text-foreground-muted",
  },
  clear: {
    icon: CheckCircle2,
    ring: "border-live/30",
    tint: "bg-live/10",
    text: "text-live",
  },
};

function AttentionRow({ item }: { item: AttentionItem }) {
  const style = LEVEL_STYLE[item.level];
  const Icon = style.icon;

  const body = (
    <>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${style.tint}`}>
        <Icon className={`h-4 w-4 ${style.text}`} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-foreground">{item.title}</span>
        <span className="text-xs leading-relaxed text-foreground-subtle">{item.detail}</span>
      </span>
      {item.hrefLabel && (
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          {item.hrefLabel}
          <ArrowRight className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        </span>
      )}
    </>
  );

  const className = `kivo-glass flex items-start gap-3 rounded-2xl border p-4 ${style.ring}`;

  if (!item.href) {
    return <div className={className}>{body}</div>;
  }
  return (
    <Link href={item.href} className={`${className} kivo-focusable transition-colors hover:bg-surface-2`}>
      {body}
    </Link>
  );
}

export default async function AdminOverviewPage() {
  const profile = await getOrCreateProfile();
  const { items, checked } = await getAdminAttention(profile?.role);
  const permitted = new Set(permittedAdminNavHrefs(profile?.role));

  const needsAction = items.filter((item) => item.level !== "clear");
  const clear = items.filter((item) => item.level === "clear");

  return (
    <div className="flex flex-col gap-8">
      <AdminPageHeader
        icon={LayoutDashboard}
        title="Overview"
        lede={
          checked.length === 0
            ? "Your role can reach Admin but carries none of its operational permissions, so there is nothing here to check. The design system is readable by every admin role."
            : needsAction.length === 0
              ? `Nothing needs a decision right now across ${checked.join(", ").toLowerCase()}.`
              : `${needsAction.length} thing${needsAction.length === 1 ? "" : "s"} need${needsAction.length === 1 ? "s" : ""} a decision.`
        }
        cost={
          checked.length > 0
            ? `Checked: ${checked.join(", ")}. Anything outside your role isn't checked here, and isn't counted as clear. Reading this page spends no provider quota.`
            : undefined
        }
      />

      {items.length > 0 && (
        <AdminSection
          icon={AlertTriangle}
          title={needsAction.length > 0 ? "Needs attention" : "All clear"}
          note={
            needsAction.length > 0
              ? "Worst first. Every item is derived from rows that exist — a check that could not run says so rather than reporting nothing."
              : undefined
          }
        >
          <div className="flex flex-col gap-2">
            {[...needsAction, ...clear].map((item, index) => (
              <FadeIn key={item.id} delay={staggerDelay(index, 0.04)}>
                <AttentionRow item={item} />
              </FadeIn>
            ))}
          </div>
        </AdminSection>
      )}

      <AdminSection icon={LayoutDashboard} title="Everything in Admin" delay={0.12}>
        <div className="flex flex-col gap-5">
          {ADMIN_NAV_GROUPS.map((group) => {
            const groupItems = group.items.filter((item) => item.href !== "/admin" && permitted.has(item.href));
            if (groupItems.length === 0) return null;
            return (
              <div key={group.id} className="flex flex-col gap-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-subtle">
                  {group.label}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {groupItems.map((item, index) => (
                    <FadeIn key={item.href} delay={0.13 + staggerDelay(index, 0.03)}>
                      <Link
                        href={item.href}
                        className="kivo-glass kivo-focusable flex h-full items-start gap-3 rounded-2xl p-4 transition-colors hover:bg-surface-2"
                      >
                        <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="text-sm font-semibold text-foreground">{item.label}</span>
                          <span className="text-xs leading-relaxed text-foreground-subtle">{item.description}</span>
                        </span>
                      </Link>
                    </FadeIn>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </AdminSection>
    </div>
  );
}
