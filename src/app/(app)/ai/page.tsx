import { ComingSoon } from "@/components/ui/coming-soon";
import { AiChat } from "@/components/ai/chat";
import { NAV_ITEMS } from "@/lib/navigation";
import { isAiConfigured } from "@/lib/ai/client";

const item = NAV_ITEMS.find((i) => i.id === "ai")!;

export default function AiCopilotPage() {
  if (!isAiConfigured()) {
    return (
      <ComingSoon icon={item.icon} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  return <AiChat />;
}
