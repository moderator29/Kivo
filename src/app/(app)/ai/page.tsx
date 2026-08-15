import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";
import { AiChat } from "@/components/ai/chat";
import { NAV_ITEMS } from "@/lib/navigation";
import { isAiConfigured } from "@/lib/ai/client";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ConversationSummary } from "./actions";

const item = NAV_ITEMS.find((i) => i.id === "ai")!;

export const metadata: Metadata = { title: item.label };

export default async function AiCopilotPage() {
  if (!isAiConfigured()) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
    );
  }

  const profile = await getOrCreateProfile();

  let initialConversations: ConversationSummary[] = [];
  if (profile) {
    const supabase = createServerSupabaseClient();
    const { data } = await supabase
      .from("ai_conversations")
      .select("id, title, updated_at")
      .eq("profile_id", profile.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    initialConversations = data ?? [];
  }

  return <AiChat signedIn={Boolean(profile)} initialConversations={initialConversations} />;
}
