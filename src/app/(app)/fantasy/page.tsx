import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "fantasy")!;

export default function FantasyPage() {
  return <ComingSoon icon={item.icon} title={item.label} description={item.comingSoonDescription!} />;
}
