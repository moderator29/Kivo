import { NextResponse } from "next/server";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isAiConfigured, getAnthropicClient, AI_MODEL } from "@/lib/ai/client";
import { buildGroundingContext, type GroundingFocus } from "@/lib/ai/grounding";
import { checkRateLimit } from "@/lib/rate-limit";
import { logError } from "@/lib/log";

// RECOMMENDATIONS.md items 184/185: the three entity types Match Centre/team
// pages/player pages can deep-link in with (see ask-ai-link.tsx). Validated
// here rather than trusted from the client — an unrecognized type/a
// malformed id is just dropped (falls back to no focus) rather than 400ing
// the whole turn, since a stale/tampered focus value shouldn't break an
// otherwise-normal chat message.
const FOCUS_TYPES = new Set(["fixture", "team", "player"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseFocus(raw: unknown): GroundingFocus | null {
  if (!raw || typeof raw !== "object") return null;
  const { type, id } = raw as { type?: unknown; id?: unknown };
  if (typeof type !== "string" || typeof id !== "string") return null;
  if (!FOCUS_TYPES.has(type) || !UUID_RE.test(id)) return null;
  return { type: type as GroundingFocus["type"], id };
}

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
- Be concise. This is a chat interface, not an essay generator.

Provenance tagging (RECOMMENDATIONS.md items 188/300) — the KIVO CONTEXT block below is split into three labelled sections: "VERIFIED KIVO DATA" (raw facts synced from the football data provider), "KIVO-CALCULATED" (real stats KIVO's own Form Engine / Match Intelligence derived from that verified data — genuine, not fabricated, but computed rather than a raw provider fact), and "KIVO-LIMITED" (an explicit statement that KIVO doesn't have enough synced matches to compute something reliably — a real, known gap, not a fabricated stat). When a sentence you write states a specific fact drawn from the VERIFIED section, prefix that sentence with the literal tag [[KIVO-VERIFIED]]. When a sentence states a specific fact drawn from the KIVO-CALCULATED section (a form trend, a goal-timing split, an H2H aggregate), prefix that sentence with the literal tag [[KIVO-CALCULATED]]. When you tell the user KIVO doesn't have enough data to answer something reliably, and that specific gap is named in the KIVO-LIMITED section, prefix that sentence with the literal tag [[KIVO-LIMITED]] instead of guessing anyway. Use the tags inline, immediately before the sentence they apply to — never as a separate list, never around general football knowledge, and never around your own inference or opinion.

Match Room posts (KIVO_NEXT_GEN KN-109) — when the user has opened the Copilot from a specific match, the KIVO CONTEXT may also contain a "KIVO-COMMUNITY" section holding real posts KIVO users wrote in that match's Match Room. Treat it as categorically different from every other section: it is what people SAID, never what happened. Rules, in order of importance: (1) never state anything from that section as a fact about the match, and never let it contradict, qualify or override the VERIFIED section — if a post claims a score or an incident that the verified data does not support, the verified data is what is true and the post is simply what someone believes; (2) summarise the mood and the recurring themes rather than listing posts back; (3) if you quote or closely paraphrase one person, name their @username, because attributing one person's opinion to "fans" is a fabricated consensus; (4) never infer a sentiment split, a percentage, or "most people think" from these posts — you are reading at most a couple of dozen of them and KIVO does not measure sentiment; (5) prefix any sentence describing what people in the Room are saying with the literal tag [[KIVO-COMMUNITY]]. If the section is empty or absent, say the Room has nothing in it yet rather than characterising a conversation that has not happened.`;

/** One line per NDJSON frame written to the response body. See the streaming
 * contract note above the POST handler for what each `type` means. */
type StreamEvent =
  | { type: "meta"; conversationId: string }
  | { type: "delta"; text: string }
  /** KN-24: the model hit `max_tokens` and the reply stops mid-thought. A
   * distinct frame rather than a flag on `done`, so the client can render the
   * honest affordance the moment the answer ends rather than inferring it. */
  | { type: "truncated" }
  | { type: "done" }
  | { type: "error"; error: string };

/**
 * The two failures a reader must be able to tell apart: something broke and
 * may work next time, versus KIVO is pointed at a model that does not exist.
 * Deliberately names the environment variable rather than the model string, so
 * whoever reads it knows where to go without KIVO echoing a value back.
 */
function aiStreamErrorMessage(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  const type = (err as { error?: { type?: unknown } } | null)?.error?.type;
  const looksUnknownModel = status === 404 || type === "not_found_error";

  return looksUnknownModel
    ? "KIVO is configured with an AI model this account cannot reach. This will not fix itself — the AI_MODEL setting needs correcting."
    : "AI Copilot is temporarily unavailable. Try again in a moment.";
}

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

  let body: { conversationId?: string; message?: string; regenerate?: boolean; focus?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // RECOMMENDATIONS.md items 184/185: the client resends the same focus on
  // every turn of a conversation that started from a deep link (see
  // chat.tsx) rather than this being persisted server-side — see grounding.ts's
  // doc comment on GroundingFocus for why that's an acceptable, honest
  // trade-off for this pass's scope.
  const focus = parseFocus(body.focus);

  // RECOMMENDATIONS.md item 194: "regenerate" re-runs the model against the
  // same existing history instead of appending a new user turn. It never
  // accepts free-text `message` — only an existing conversationId owned by
  // this profile, which must already have a prior assistant reply to redo.
  const isRegenerate = body.regenerate === true;

  const message = (body.message ?? "").trim();
  if (!isRegenerate && (!message || message.length > MAX_MESSAGE_LENGTH)) {
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

  if (isRegenerate && !conversationId) {
    return NextResponse.json({ error: "No conversation to regenerate." }, { status: 400 });
  }

  if (!conversationId) {
    const { data: created, error } = await supabase
      .from("ai_conversations")
      .insert({ profile_id: profile.id, title: message.slice(0, 80) })
      .select("id")
      .single();
    if (error || !created) {
      logError("api.ai.chat.createConversation", error);
      return NextResponse.json({ error: "Couldn't start a conversation." }, { status: 500 });
    }
    conversationId = created.id;
  }

  if (isRegenerate) {
    // Delete only the most recent assistant reply so regenerating doesn't
    // leave two answers stacked for the same user turn — the last user
    // message stays in place and gets reused as-is via the history fetch
    // below.
    const { data: lastAssistant } = await supabase
      .from("ai_messages")
      .select("id")
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastAssistant) {
      await supabase.from("ai_messages").delete().eq("id", lastAssistant.id);
    }
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

  if (!isRegenerate) {
    const { error: insertUserError } = await supabase
      .from("ai_messages")
      .insert({ conversation_id: conversationId, role: "user", content: message });
    if (insertUserError) {
      logError("api.ai.chat.persistUserMessage", insertUserError);
    }
  }

  // KIVO_NEXT_GEN KN-108: the message itself is part of the retrieval now. The
  // football entities the user named are resolved deterministically against
  // KIVO's own tables before the model runs, so asking about a real club the
  // viewer happens not to follow no longer produces a confident "KIVO doesn't
  // have that" about a row KIVO is holding.
  const grounding = await buildGroundingContext(profile, focus, message);
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
            // Regenerate reuses the last user message already present in
            // `history` above (only the trailing assistant reply was
            // deleted) — appending it again here would double it up.
            ...(isRegenerate ? [] : [{ role: "user" as const, content: message }]),
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

        // KN-24. A reply that hit the 1024-token ceiling stops mid-sentence and
        // is otherwise indistinguishable from a finished one — persisted as if
        // complete, rendered without comment, offered for regenerate with no
        // explanation of why it reads oddly. KIVO's whole discipline is not
        // presenting something as more complete or more certain than it is;
        // items 188/189 applied that to provenance, this applies it to
        // completeness. Told twice, deliberately: once live over the stream for
        // whoever is watching, and once in the row, so reopening the
        // conversation from history says the same thing (migration 0069).
        if (finalMessage.stop_reason === "max_tokens") {
          send({ type: "truncated" });
        }

        const { error: insertAssistantError } = await supabase.from("ai_messages").insert({
          conversation_id: finalConversationId,
          role: "assistant",
          content: reply,
          // RECOMMENDATIONS.md item 190: persist the real per-turn cost so
          // it's queryable later, even though enforcement above is a
          // message-count cap rather than a token sum.
          input_tokens: finalMessage.usage.input_tokens,
          output_tokens: finalMessage.usage.output_tokens,
          // Verbatim from the API, never normalised or defaulted — a null here
          // means "the API reported none", not "it finished normally".
          stop_reason: finalMessage.stop_reason,
        });
        if (insertAssistantError) {
          logError("api.ai.chat.persistAssistantMessage", insertAssistantError);
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
          logError("api.ai.chat.bumpConversationUpdated", touchError);
        }

        send({ type: "done" });
      } catch (err) {
        logError("api.ai.chat.anthropicStreamingRequest", err);
        // A misconfigured AI_MODEL is not a transient failure and must not be
        // reported as one. "Try again in a moment" is a promise that the next
        // attempt might work; with a model name Anthropic does not recognise,
        // every attempt fails identically forever, and the reader is told to
        // keep waiting for something that will never arrive. Worse, it points
        // the founder at an outage rather than at their own environment
        // variable, which is the one place the fix actually is.
        //
        // Anthropic answers an unknown model with a 404 carrying a
        // `not_found_error`. Read defensively — this is an error object from a
        // network boundary, so nothing about its shape is guaranteed.
        send({ type: "error", error: aiStreamErrorMessage(err) });
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
