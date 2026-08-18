import { ComingSoon } from "@/components/ui/coming-soon";
import { getNavItem } from "@/lib/navigation";

const item = getNavItem("news");

export default function NewsPage() {
  return (
    <ComingSoon icon={<item.icon className="h-9 w-9 text-on-accent" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
  );
}
