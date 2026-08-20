import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui/coming-soon";
import { AiChat } from "@/components/ai/chat";
import { ShareCardPanel } from "@/components/share/share-card-panel";
import { getNavItem } from "@/lib/navigation";
import { isAiConfigured } from "@/lib/ai/client";
import { buildGroundingContext, type GroundingFocus } from "@/lib/ai/grounding";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { getTransparencyFreshness } from "@/lib/football/last-updated";
import { viewerIsSignedIn } from "@/lib/guest-preview";
import type { ConversationSummary } from "./actions";

const item = getNavItem("ai");

export const metadata: Metadata = { title: item.label };

const FOCUS_TYPES = new Set(["fixture", "team", "player"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// RECOMMENDATIONS.md items 184/185: the deep-link contract ask-ai-link.tsx's
// entry points use — `/ai?ctx=<type>&id=<uuid>`. An unrecognized ctx or a
// malformed id degrades to "no focus" rather than a 400/notFound, since
// landing on plain `/ai` with a stale or hand-edited query string should
// still work as an ordinary Copilot session.
function parseFocus(ctx?: string, id?: string): GroundingFocus | null {
  if (!ctx || !id || !FOCUS_TYPES.has(ctx) || !UUID_RE.test(id)) return null;
  return { type: ctx as GroundingFocus["type"], id };
}

export default async function AiCopilotPage({
  searchParams,
}: {
  searchParams: Promise<{ ctx?: string; id?: string }>;
}) {
  if (!isAiConfigured()) {
    return (
      <ComingSoon
        icon={<item.icon className="h-9 w-9 text-on-accent" strokeWidth={1.5} />}
        image={item.comingSoonImage}
        title={item.label}
        description={item.comingSoonDescription ?? "Check back soon."}
        whatItWillDo={item.comingSoonDetails}
        whyNotYet={item.comingSoonBlocker}
      />
    );
  }

  const { ctx, id } = await searchParams;
  const focus = parseFocus(ctx, id);

  const profile = await getOrCreateProfile();

  let initialConversations: ConversationSummary[] = [];
  if (profile) {
    const supabase = createServerSupabaseClient();
    // Tolerant: the Copilot is usable with no history at all, so a failed
    // read costs the sidebar rather than the page. Routed through readList so
    // it is logged — a silently empty conversation list looks exactly like a
    // first visit, and that is worth being able to find afterwards.
    const conversationsOutcome = readList(
      await supabase
        .from("ai_conversations")
        .select("id, title, updated_at")
        .eq("profile_id", profile.id)
        .order("updated_at", { ascending: false })
        .limit(50),
      "ai.conversations",
    );
    initialConversations = conversationsOutcome.rows;
  }

  // RECOMMENDATIONS.md item 183: buildGroundingContext already computes
  // these flags on every chat turn but they were dropped on the floor. Fetch
  // them once here (cheap — the request-scoped Supabase client is memoized,
  // see createServerSupabaseClient's cache() wrapper) so the client can
  // reflect real state instead of hardcoding suggestions/copy that assume
  // data the app may not actually have synced yet.
  //
  // RECOMMENDATIONS.md items 184/185/189: also doubles as the very first
  // grounded turn's context when the user arrived via a fixture/team/player
  // deep link (focus, resolved above from ?ctx=&id=) and as the source data
  // for the "what KIVO knows right now" disclosure panel — see
  // grounding.ts's disclosureLabel and AiChat's groundingSummary prop.
  const grounding = focus ? await buildGroundingContext(profile, focus) : await buildGroundingContext(profile);

  // RECOMMENDATIONS.md item 189: reuses /transparency's exact freshness
  // helper rather than re-deriving "how current is this" here — see
  // getTransparencyFreshness's own doc comment for why exactly one narrow
  // field ever leaves sync_runs this way.
  const freshness = await getTransparencyFreshness();

  // The most recent answer this viewer actually received, if there is one.
  // An insight card carries a real Copilot reply verbatim rather than a fresh
  // generation — sharing "what KIVO told me" only means anything if it is the
  // message the sharer read. Nothing is offered until a conversation exists.
  let latestAnswerId: string | null = null;
  if (profile && initialConversations.length > 0) {
    const supabase = createServerSupabaseClient();
    const { data: latestAnswer } = await supabase
      .from("ai_messages")
      .select("id")
      .eq("conversation_id", initialConversations[0].id)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestAnswerId = latestAnswer?.id ?? null;
  }

  return (
    <>
    <AiChat
      signedIn={viewerIsSignedIn(profile)}
      initialConversations={initialConversations}
      hasFollowedEntities={grounding.hasFollowedEntities}
      hasFixturesToday={grounding.hasFixturesToday}
      initialFocus={focus}
      focusLabel={grounding.disclosureLabel}
      groundingSummary={grounding.summary}
      lastUpdatedAt={freshness.lastUpdatedAt}
    />
      {latestAnswerId && (
        // FRONTEND SWEEP: this hand-rolled a column with a different gap and
        // a different bottom padding from `.kivo-page`, which is what AiChat
        // directly above it renders into — so the share panel sat inset from
        // the conversation it belongs to by a few pixels nobody could name.
        <div className="kivo-page pt-0">
          <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
            <ShareCardPanel
              kind="ai-insight"
              id={latestAnswerId}
              shareUrl="/ai"
              shareText="Asked KIVO's Copilot."
              heading="Share this answer"
              description="The card carries the answer you were given, word for word, on whichever background you pick."
            />
          </div>
        </div>
      )}
    </>
  );
}
