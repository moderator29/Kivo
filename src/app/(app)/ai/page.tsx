import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";
import { AiChat } from "@/components/ai/chat";
import { getNavItem } from "@/lib/navigation";
import { isAiConfigured } from "@/lib/ai/client";
import { buildGroundingContext } from "@/lib/ai/grounding";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { ConversationSummary } from "./actions";

const item = getNavItem("ai");

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

  // RECOMMENDATIONS.md item 183: buildGroundingContext already computes
  // these flags on every chat turn but they were dropped on the floor. Fetch
  // them once here (cheap — the request-scoped Supabase client is memoized,
  // see createServerSupabaseClient's cache() wrapper) so the client can
  // reflect real state instead of hardcoding suggestions/copy that assume
  // data the app may not actually have synced yet.
  const grounding = await buildGroundingContext(profile);

  return (
    <AiChat
      signedIn={Boolean(profile)}
      initialConversations={initialConversations}
      hasFollowedEntities={grounding.hasFollowedEntities}
      hasSyncedFixtures={grounding.hasSyncedFixtures}
    />
  );
}
