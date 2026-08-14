import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "ai")!;

export default function AiCopilotPage() {
  return (
    <ComingSoon icon={item.icon} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
  );
}
