import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/lib/navigation";

const item = getNavItem("highlights");

export const metadata: Metadata = { title: item.label };

/**
 * Video highlights: named in the founding directive, blocked on rights rather
 * than on work, and therefore present in navigation as an honest Coming Soon.
 *
 * The alternative — leaving it out of the nav entirely — hides a promised
 * feature instead of accounting for it, and the alternative to *that* — a tab
 * that links out to whatever clips happen to be on the open internet — is the
 * kind of "working feature" that is really someone else's content laundered
 * through KIVO's chrome. The copy lives on the nav entry (navigation.ts) so
 * every gap in the product is described in one place.
 */
export default function HighlightsPage() {
  return (
    <ComingSoon
      icon={<item.icon className="h-9 w-9 text-on-accent" strokeWidth={1.5} />}
      image={item.comingSoonImage}
      title={item.label}
      description={item.comingSoonDescription ?? "Check back soon."}
      whatItWillDo={item.comingSoonDetails}
      whyNotYet={item.comingSoonBlocker}
    />
  );
}
