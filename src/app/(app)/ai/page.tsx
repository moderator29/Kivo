import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";
import { AiChat } from "@/components/ai/chat";
import { NAV_ITEMS } from "@/lib/navigation";
import { isAiConfigured } from "@/lib/ai/client";
import { getOrCreateProfile } from "@/lib/profile";

const item = NAV_ITEMS.find((i) => i.id === "ai")!;

export const metadata: Metadata = { title: item.label };

export default async function AiCopilotPage() {
  if (!isAiConfigured()) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  const profile = await getOrCreateProfile();
  return <AiChat signedIn={Boolean(profile)} />;
}
