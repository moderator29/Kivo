"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { checkRateLimit } from "@/lib/rate-limit";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

export type ConversationSummary = Pick<
  Database["public"]["Tables"]["ai_conversations"]["Row"],
  "id" | "title" | "updated_at"
>;
export type ConversationMessage = Pick<
  Database["public"]["Tables"]["ai_messages"]["Row"],
  // KN-24: stop_reason travels with the message so a conversation reopened
  // from history says the same thing about a cut-short reply that the live
  // stream said. Without it the honesty lasts exactly one page view.
  "id" | "role" | "content" | "created_at" | "stop_reason"
>;

const MAX_TITLE_LENGTH = 80;

/**
 * Loads one conversation's messages for the history panel's "resume" click.
 * ai_messages RLS already scopes reads to the owning profile via the parent
 * ai_conversations row (see 0001_kivo_core_schema.sql), so an id belonging to
 * another user simply returns no rows here rather than needing a manual
 * ownership check — this explicit profile_id check on the conversation itself
 * is defense in depth so the caller gets a clean "not found" instead of a
 * silently empty message list.
 */
export async function loadConversationMessages(
  conversationId: string,
): Promise<{ messages: ConversationMessage[]; error: null } | { messages: null; error: string }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { messages: null, error: "You must be signed in." };

  const supabase = createServerSupabaseClient();

  const { data: owned } = await supabase
    .from("ai_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (!owned) return { messages: null, error: "Conversation not found." };

  const { data, error } = await supabase
    .from("ai_messages")
    .select("id, role, content, created_at, stop_reason")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    logError("ai.loadConversationMessages", error);
    return { messages: null, error: "Couldn't load that conversation." };
  }

  return { messages: data ?? [], error: null };
}

export async function renameConversation(
  conversationId: string,
  title: string,
): Promise<{ error: string | null }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const trimmed = title.trim().slice(0, MAX_TITLE_LENGTH);
  if (!trimmed) return { error: "Title can't be empty." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "rename_ai_conversation", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("ai_conversations")
    .update({ title: trimmed })
    .eq("id", conversationId)
    .eq("profile_id", profile.id);

  if (error) {
    logError("ai.renameConversation", error);
    return { error: "Couldn't rename that conversation." };
  }

  revalidatePath("/ai");
  return { error: null };
}

/**
 * Deletes a conversation. ai_messages.conversation_id has `on delete cascade`
 * (0001_kivo_core_schema.sql line ~1121), so the DB removes the conversation's
 * messages automatically — no separate delete of ai_messages needed here.
 */
export async function deleteConversation(conversationId: string): Promise<{ error: string | null }> {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "delete_ai_conversation", 20, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("profile_id", profile.id);

  if (error) {
    logError("ai.deleteConversation", error);
    return { error: "Couldn't delete that conversation." };
  }

  revalidatePath("/ai");
  return { error: null };
}
