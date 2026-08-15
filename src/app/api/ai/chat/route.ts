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

// RECOMMENDATIONS.md item 190 ($0 budget mindset): a per-minute burst limit
// alone doesn't bound a scripted client's total daily spend. This reuses the
// exact checkRateLimit()/rate_limit_events sliding-window pattern above
// (same helper, a second `action` key so it counts independently) rather
// than summing token usage on every request — a message-count ceiling is
// enough to keep worst-case daily cost bounded, since max_tokens is fixed
// per call. Real per-message token usage is still persisted on ai_messages
// (see the insert below) for future cost reporting.
const AI_CHAT_DAILY_MAX_REQUESTS = 60;
const AI_CHAT_DAILY_WINDOW_SECONDS = 60 * 60 * 24;

const SYSTEM_PROMPT = `You are KIVO's AI Copilot, a football intelligence assistant embedded in the KIVO app.

Grounding rules — these override any instinct to be maximally helpful:
- A "KIVO CONTEXT" block below lists exactly what KIVO's database currently knows about this user and today's fixtures. Treat it as the ONLY source of truth for anything specific and current (today's matches, scores, this user's follows/favourite team).
- If the KIVO CONTEXT says no fixtures are synced, or doesn't mention something the user asks about, say plainly that KIVO doesn't have that data yet — never fill the gap from general knowledge, and never state a specific current score, standing, squad, or transfer as if it were verified fact.
- You MAY answer general, evergreen football knowledge (rules, tactics concepts, what xG means, historical facts you're confident are stable) — but if a claim could plausibly have changed recently (current form, current squad, current manager, this season's standings), say you're not certain and that KIVO doesn't have it synced, rather than guessing from training data.
- Distinguish explicitly between: verified KIVO data, general football knowledge, and your own inference/opinion — don't blur these together.
- Be concise. This is a chat interface, not an essay generator.`;

/** One line per NDJSON frame written to the response body. See the streaming
 * contract note above the POST handler for what each `type` means. */
type StreamEvent =
  | { type: "meta"; conversationId: string }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; error: string };

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

  const dailyLimit = await checkRateLimit(
    `user:${profile.id}`,
    "ai_chat_daily",
    AI_CHAT_DAILY_MAX_REQUESTS,
    AI_CHAT_DAILY_WINDOW_SECONDS,
  );
  if (!dailyLimit.ok) {
    return NextResponse.json(
      { error: "You've reached today's AI Copilot usage limit. Try again tomorrow." },
      { status: 429 },
    );
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
  const anthropic = getAnthropicClient();
  const finalConversationId = conversationId;

  // Streamed as newline-delimited JSON (one frame per line) rather than
  // full-response JSON — RECOMMENDATIONS.md item 187: tokens render as they
  // arrive instead of appearing all at once after the whole reply completes.
  // A plain fetch + ReadableStream reader on the client (src/components/ai/
  // chat.tsx) parses this; SSE/EventSource wasn't used because EventSource
  // only supports GET requests, not this endpoint's POST body.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: StreamEvent) {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }

      send({ type: "meta", conversationId: finalConversationId });

      try {
        // The system prompt is long and constant across every request; the
        // KIVO CONTEXT block is not (it's rebuilt per user/per turn). Only
        // the constant block carries cache_control, so Anthropic's prompt
        // caching (RECOMMENDATIONS.md item 191) can reuse it across calls
        // without ever serving stale grounding data — this reduces cost,
        // it does not add spend (see AGENTS.md's $0 budget note on this
        // item). See shared/prompt-caching.md: min cacheable prefix is
        // model-dependent, so this has no effect (and no downside) if
        // SYSTEM_PROMPT alone is ever under that model's minimum.
        const anthropicStream = anthropic.messages.stream({
          model: AI_MODEL,
          max_tokens: 1024,
          system: [
            { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: `KIVO CONTEXT:\n${grounding.summary}` },
          ],
          messages: [
            ...(history ?? [])
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
            { role: "user" as const, content: message },
          ],
        });

        for await (const event of anthropicStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ type: "delta", text: event.delta.text });
          }
        }

        const finalMessage = await anthropicStream.finalMessage();
        const reply = finalMessage.content
          .filter((block) => block.type === "text")
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("\n")
          .trim();

        const { error: insertAssistantError } = await supabase.from("ai_messages").insert({
          conversation_id: finalConversationId,
          role: "assistant",
          content: reply,
          // RECOMMENDATIONS.md item 190: persist the real per-turn cost so
          // it's queryable later, even though enforcement above is a
          // message-count cap rather than a token sum.
          input_tokens: finalMessage.usage.input_tokens,
          output_tokens: finalMessage.usage.output_tokens,
        });
        if (insertAssistantError) {
          console.error("Failed to persist assistant message", insertAssistantError);
        }

        // ai_conversations.updated_at only moves on an update to that row
        // itself (trg_ai_conversations_updated_at) — inserting into
        // ai_messages doesn't touch it. The history list orders by
        // updated_at as "most recent activity", so touch it here on every
        // turn, not just on rename.
        const { error: touchError } = await supabase
          .from("ai_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", finalConversationId);
        if (touchError) {
          console.error("Failed to bump AI conversation updated_at", touchError);
        }

        send({ type: "done" });
      } catch (err) {
        console.error("Anthropic streaming request failed", err);
        send({ type: "error", error: "AI Copilot is temporarily unavailable. Try again in a moment." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
