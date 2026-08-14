import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "teams")!;

export default function TeamsPage() {
  return <ComingSoon icon={item.icon} title={item.label} description={item.comingSoonDescription!} />;
}
