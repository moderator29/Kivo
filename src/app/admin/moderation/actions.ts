"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canViewModerationData } from "@/lib/admin";
import { checkRateLimit } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { logError } from "@/lib/log";

/**
 * The two decisions a moderator can record on a report.
 *
 * `report_status` is a Postgres enum with four values, and only two of them
 * are decisions — 'pending' and 'reviewing' are queue states. Without the
 * runtime check below, `decision` is a TypeScript-only guarantee: a Server
 * Action is an HTTP endpoint, its arguments arrive as untyped JSON, and
 * `.update({ status: decision })` would happily push a report back to
 * 'pending' while writing a `moderation_actions` row whose `action` column
 * (free text) recorded the string "pending" as though it were a verdict.
 *
 * A wrong value here does not fail loudly. It becomes a moderation outcome.
 */
const RESOLVE_DECISIONS = ["actioned", "dismissed"] as const;
export type Decision = (typeof RESOLVE_DECISIONS)[number];

function isDecision(value: unknown): value is Decision {
  return typeof value === "string" && (RESOLVE_DECISIONS as readonly string[]).includes(value);
}

/** Matches `moderation_actions.reason`'s use elsewhere and the note input's
 * own maxLength, so an over-long note is a readable refusal rather than a
 * silently truncated audit record. */
const MAX_NOTE_LENGTH = 500;

/**
 * Records a moderator's decision on one report.
 *
 * WHAT THIS DOES AND DOES NOT DO, because the tool must not imply more than
 * it performs: resolving a report closes the report and writes two audit
 * rows. It does not delete the post, hide the comment, or sanction the
 * author — those are separate, deliberate acts on /admin/users. The queue's
 * own copy says so in as many words; see ReportRow.
 *
 * Three things this function guarantees that it previously did not.
 *
 * 1. The decision is validated at runtime, not only at compile time.
 *
 * 2. It cannot be issued twice. The old shape read the report's status and
 *    then issued an unconditional update, so two moderators triaging the same
 *    queue — or one moderator double-clicking — both passed the read and both
 *    wrote: two `moderation_actions` rows for one report, and the second
 *    decision silently overwriting the first's `resolved_by_profile_id`. The
 *    update is now a compare-and-swap: it only matches a report still open,
 *    so exactly one caller can win and the loser is told what happened.
 *
 * 3. It writes to `audit_log` as well as `moderation_actions`. Those two
 *    tables had drifted into being half a ledger each — report decisions went
 *    to one, account sanctions to the other — so neither could answer "what
 *    has this moderator done". Every moderation write in this codebase now
 *    lands in both.
 */
export async function resolveReport(reportId: string, decision: Decision, note: string) {
  const profile = await getOrCreateProfile();
  if (!profile || !canViewModerationData(profile.role)) {
    return { error: "You don't have moderation access." };
  }

  if (!isDecision(decision)) {
    return { error: "That isn't a decision this queue can record." };
  }

  const trimmedNote = note.trim();
  if (trimmedNote.length > MAX_NOTE_LENGTH) {
    return { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer.` };
  }

  // Moderation is a privileged path, so this is not spam control — it is a
  // bound on how much damage a compromised or stuck moderator client can do
  // before somebody notices. Generous enough that real triage never touches
  // it: fifty decisions a minute is faster than anyone reads a report.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "resolve_report", 50, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();

  // Compare-and-swap. `.in("status", ...)` is the whole guard: the row is
  // only updated while it is still open, so a second caller matches nothing
  // and gets `null` back rather than quietly re-deciding a settled report.
  const { data: resolved, error: updateError } = await supabase
    .from("reports")
    .update({
      status: decision,
      resolved_by_profile_id: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", reportId)
    .in("status", ["pending", "reviewing"])
    .select("id, target_type, target_id")
    .maybeSingle();

  if (updateError) {
    logError("admin.moderation.resolveReport", updateError);
    return { error: "Couldn't update the report. Try again." };
  }

  if (!resolved) {
    // Nothing was updated. Two very different reasons, and a moderator needs
    // to know which — "already resolved" means somebody else acted, and
    // "no longer exists" means the row is gone. Reported separately rather
    // than collapsed into one vague failure.
    const { data: existing } = await supabase
      .from("reports")
      .select("status, resolved_by:profiles!reports_resolved_by_profile_id_fkey(username)")
      .eq("id", reportId)
      .maybeSingle();

    if (!existing) return { error: "That report no longer exists." };
    const by = existing.resolved_by?.username;
    return {
      error: by
        ? `Already resolved as ${existing.status} by @${by}. Reload the queue.`
        : `That report was already resolved as ${existing.status}. Reload the queue.`,
    };
  }

  const { error: auditError } = await supabase.from("moderation_actions").insert({
    admin_profile_id: profile.id,
    action: decision,
    target_type: resolved.target_type,
    target_id: resolved.target_id,
    reason: trimmedNote || null,
    report_id: resolved.id,
  });

  if (auditError) logError("admin.moderation.writeAuditRow", auditError);

  await logAudit(
    profile.id,
    `resolve_report_${decision}`,
    resolved.target_type,
    { reportId: resolved.id },
    // The reported content, not the report — `target_type` above is already the
    // content's type, so the pair reads as one addressable subject on
    // /admin/audit and matches the (target_type, target_id) index.
    { targetId: resolved.target_id, reason: trimmedNote || null },
  );

  revalidatePath("/admin/moderation");
  return { error: null };
}
