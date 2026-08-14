import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "news")!;

export default function NewsPage() {
  return (
    <ComingSoon icon={item.icon} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
  );
}
