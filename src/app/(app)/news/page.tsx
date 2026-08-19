import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/lib/navigation";

const item = getNavItem("news");

export const metadata: Metadata = { title: item.label };

/**
 * News is blocked on a licence, not on engineering. The page says which, and
 * says what the feature will actually be — see the nav entry in
 * navigation.ts, which is where every Coming Soon's copy lives so the whole
 * set of honest gaps can be read in one file.
 */
export default function NewsPage() {
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
