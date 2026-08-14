import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "leagues")!;

export default function LeaguesPage() {
  return <ComingSoon icon={item.icon} title={item.label} description={item.comingSoonDescription!} />;
}
