import { ComingSoon } from "@/components/ui/coming-soon";
import { AiChat } from "@/components/ai/chat";
import { NAV_ITEMS } from "@/lib/navigation";
import { isAiConfigured } from "@/lib/ai/client";
import { getOrCreateProfile } from "@/lib/profile";

const item = NAV_ITEMS.find((i) => i.id === "ai")!;

export default async function AiCopilotPage() {
  if (!isAiConfigured()) {
    return (
      <ComingSoon icon={item.icon} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  const profile = await getOrCreateProfile();
  return <AiChat signedIn={Boolean(profile)} />;
}
