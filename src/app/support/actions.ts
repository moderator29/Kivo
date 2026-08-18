"use server";

import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { resolveViewerProfile } from "@/lib/profile";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { Database } from "@/lib/supabase/types";
import { SUPPORT_TOPICS, type SupportTopic } from "./topics";
import { logError } from "@/lib/log";

export type SupportSubmitResult = { ok: true } | { ok: false; error: string };

type SupportRequestInsert = Database["public"]["Tables"]["support_requests"]["Insert"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_MESSAGE = 10;
const MAX_MESSAGE = 4000;

function isSupportTopic(value: string): value is SupportTopic {
  return SUPPORT_TOPICS.some((topic) => topic.value === value);
}

/**
 * The write half of /support — KIVO's only route from a locked-out user to a
 * human (KN-118).
 *
 * SERVICE ROLE, DELIBERATELY. The defining caller here cannot sign in; that is
 * the whole reason the page exists. Giving `anon` an INSERT policy on
 * `support_requests` would have made it the one world-writable table in the
 * schema, so migration 0055 gives the table no client-facing write policy at
 * all and routes the insert through the service-role client instead — the same
 * shape `rate_limit_events` has used since 0013. The throttle below is what
 * takes the place of the missing policy, so it runs BEFORE anything is written
 * and its failure is fatal to the request rather than logged and shrugged off.
 *
 * Two keys, same reasoning as the auth actions: the address key stops one
 * person filing the same thing fifty times, the IP key stops one script filing
 * fifty different things.
 */
export async function submitSupportRequest(formData: FormData): Promise<SupportSubmitResult> {
  const replyEmail = String(formData.get("reply_email") ?? "").trim().toLowerCase();
  const topic = String(formData.get("topic") ?? "");
  const message = String(formData.get("message") ?? "").trim();

  if (!EMAIL_PATTERN.test(replyEmail) || replyEmail.length > 254) {
    return { ok: false, error: "Enter an email address we can reply to." };
  }
  if (!isSupportTopic(topic)) {
    return { ok: false, error: "Choose what this is about." };
  }
  if (message.length < MIN_MESSAGE) {
    return { ok: false, error: `Tell us a little more — at least ${MIN_MESSAGE} characters.` };
  }
  if (message.length > MAX_MESSAGE) {
    return { ok: false, error: `Keep it under ${MAX_MESSAGE} characters.` };
  }

  let supabase: ReturnType<typeof createServiceRoleSupabaseClient>;
  try {
    supabase = createServiceRoleSupabaseClient();
  } catch (error) {
    // No service-role key: nothing can be written, and pretending otherwise
    // would leave someone believing a human is coming who never will.
    logError("support.supportRequestsAreUnavailable", error);
    return {
      ok: false,
      error: "Support requests aren't available in this environment yet. Nothing was sent.",
    };
  }

  // Five per address and fifteen per IP a day. Generous for a real person with
  // a real problem (including one who files, waits, and follows up), tight
  // enough that this never becomes a way to fill an admin queue.
  const byEmail = await checkRateLimit(`email:${replyEmail}`, "support_request", 5, 60 * 60 * 24);
  if (!byEmail.ok) {
    return { ok: false, error: "You've already sent us a few messages today. We'll get to them." };
  }
  const byIp = await checkRateLimit(`ip:${await getClientIp()}`, "support_request", 15, 60 * 60 * 24);
  if (!byIp.ok) {
    return { ok: false, error: "Too many requests from this connection today. Try again tomorrow." };
  }

  // Attach the profile only if they happen to be signed in — most people
  // reaching this page are not, by construction. Resolved through the caller's
  // own session, never from anything the form posted.
  const viewer = await resolveViewerProfile();

  const row: SupportRequestInsert = {
    reply_email: replyEmail,
    topic,
    message,
    profile_id: viewer.status === "ready" ? viewer.profile.id : null,
  };

  const { error } = await supabase.from("support_requests").insert(row);
  if (error) {
    logError("support.recordSupportRequest", error);
    return { ok: false, error: "We couldn't send that. Try again in a moment." };
  }

  return { ok: true };
}
