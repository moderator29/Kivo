"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { canHandleSupport } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import type { Database } from "@/lib/supabase/types";
import { logError } from "@/lib/log";

type SupportStatus = Database["public"]["Enums"]["support_request_status"];

const STATUSES: SupportStatus[] = ["open", "in_progress", "closed"];

/**
 * Move a support request through its queue, and optionally leave a note for
 * whoever picks it up next.
 *
 * The role check here is belt-and-braces over RLS, not a substitute for it:
 * `support_requests_update_admin` (migration 0055) already refuses this write
 * for anyone outside support_admin/admin/super_admin, and it refuses it at the
 * database, where a bug in this file cannot reach. The check exists so a
 * non-support admin gets a real message instead of a silent zero-rows update.
 */
export async function updateSupportRequest(
  id: string,
  status: string,
  internalNote: string | null,
): Promise<{ error: string | null }> {
  const profile = await getOrCreateProfile();
  if (!profile || !canHandleSupport(profile.role)) {
    return { error: "You don't have access to the support queue." };
  }

  if (!STATUSES.includes(status as SupportStatus)) {
    return { error: "Unknown status." };
  }
  const note = internalNote?.trim() ?? "";
  if (note.length > 4000) {
    return { error: "Note must be 4000 characters or fewer." };
  }

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("support_requests")
    .update({
      status: status as SupportStatus,
      internal_note: note.length > 0 ? note : null,
      // The handled pair is a table constraint, so both move together or
      // neither does. "Open" means nobody has taken it, so taking it back to
      // open clears the pair rather than leaving a stale owner on it.
      handled_by: status === "open" ? null : profile.id,
      handled_at: status === "open" ? null : new Date().toISOString(),
    })
    .eq("id", id)
    .select("id")
    .maybeSingle();

  if (error) {
    logError("admin.support.updateSupportRequest", error);
    return { error: "Couldn't update that request. Try again." };
  }
  if (!data) {
    // RLS refused it, or the row is gone. Either way, say so rather than
    // reporting a success that never happened.
    return { error: "That request couldn't be updated — it may have been removed." };
  }

  await logAudit(profile.id, "support_request_updated", "support_requests", { status }, { targetId: id });

  revalidatePath("/admin/support");
  return { error: null };
}
