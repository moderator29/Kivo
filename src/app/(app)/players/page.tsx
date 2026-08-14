import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "players")!;

export default function PlayersPage() {
  return <ComingSoon icon={item.icon} title={item.label} description={item.comingSoonDescription!} />;
}
