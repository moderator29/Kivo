import { NextResponse } from "next/server";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAiConfigured, getAnthropicClient, AI_MODEL } from "@/lib/ai/client";
import { buildGroundingContext } from "@/lib/ai/grounding";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 20;

// Each call costs real money against the Anthropic API, so this cap is
// tighter than the app's other rate limits.
const AI_CHAT_MAX_REQUESTS = 10;
const AI_CHAT_WINDOW_SECONDS = 60;

const SYSTEM_PROMPT = `You are KIVO's AI Copilot, a football intelligence assistant embedded in the KIVO app.

Grounding rules — these override any instinct to be maximally helpful:
- A "KIVO CONTEXT" block below lists exactly what KIVO's database currently knows about this user and today's fixtures. Treat it as the ONLY source of truth for anything specific and current (today's matches, scores, this user's follows/favourite team).
- If the KIVO CONTEXT says no fixtures are synced, or doesn't mention something the user asks about, say plainly that KIVO doesn't have that data yet — never fill the gap from general knowledge, and never state a specific current score, standing, squad, or transfer as if it were verified fact.
- You MAY answer general, evergreen football knowledge (rules, tactics concepts, what xG means, historical facts you're confident are stable) — but if a claim could plausibly have changed recently (current form, current squad, current manager, this season's standings), say you're not certain and that KIVO doesn't have it synced, rather than guessing from training data.
- Distinguish explicitly between: verified KIVO data, general football knowledge, and your own inference/opinion — don't blur these together.
- Be concise. This is a chat interface, not an essay generator.`;

export async function POST(req: Request) {
  const profile = await getOrCreateProfile();
  if (!profile) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI Copilot isn't configured in this environment yet." }, { status: 503 });
  }

  const rateLimit = await checkRateLimit(
    `user:${profile.id}`,
    "ai_chat",
    AI_CHAT_MAX_REQUESTS,
    AI_CHAT_WINDOW_SECONDS,
  );
  if (!rateLimit.ok) {
    return NextResponse.json({ error: rateLimit.error }, { status: 429 });
  }

  let body: { conversationId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: `Message must be 1-${MAX_MESSAGE_LENGTH} characters.` }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  let conversationId = body.conversationId;
  if (conversationId) {
    const { data: owned } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("profile_id", profile.id)
      .maybeSingle();
    if (!owned) conversationId = undefined;
  }

  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("ai_conversations")
      .insert({ profile_id: profile.id, title: message.slice(0, 80) })
      .select("id")
      .single();
    if (error || !created) {
      console.error("Failed to create AI conversation", error);
      return NextResponse.json({ error: "Couldn't start a conversation." }, { status: 500 });
    }
    conversationId = created.id;
  }

  // Fetch the most recent MAX_HISTORY_MESSAGES (newest first via the
  // descending order + limit), then reverse back to chronological order —
  // the model needs oldest-first in the prompt. Ordering ascending before
  // the limit would instead return the oldest messages in the conversation,
  // which is wrong past message twenty.
  const { data: recentHistory } = await supabase
    .from("ai_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  const history = recentHistory ? [...recentHistory].reverse() : recentHistory;

  const { error: insertUserError } = await supabase
    .from("ai_messages")
    .insert({ conversation_id: conversationId, role: "user", content: message });
  if (insertUserError) {
    console.error("Failed to persist user message", insertUserError);
  }

  const grounding = await buildGroundingContext(profile);

  try {
    const anthropic = getAnthropicClient();
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1024,
      system: `${SYSTEM_PROMPT}\n\nKIVO CONTEXT:\n${grounding.summary}`,
      messages: [
        ...(history ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
        { role: "user" as const, content: message },
      ],
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("\n")
      .trim();

    const { error: insertAssistantError } = await supabase
      .from("ai_messages")
      .insert({ conversation_id: conversationId, role: "assistant", content: reply });
    if (insertAssistantError) {
      console.error("Failed to persist assistant message", insertAssistantError);
    }

    return NextResponse.json({ conversationId, reply });
  } catch (err) {
    console.error("Anthropic request failed", err);
    return NextResponse.json(
      { error: "AI Copilot is temporarily unavailable. Try again in a moment." },
      { status: 502 },
    );
  }
}
