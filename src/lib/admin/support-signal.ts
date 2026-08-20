import "server-only";
import type { Database } from "@/lib/supabase/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canHandleSupport } from "@/lib/admin";
import { logError } from "@/lib/log";

type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * The support queue, reduced to something the Admin chrome can carry on every
 * page.
 *
 * ## What this is a partial answer to
 *
 * RECOMMENDATIONS A8: "Nothing notifies anybody of anything. The support queue
 * is the only route back in for a locked-out user and it is checked only by
 * somebody choosing to open the page." That is still true of *notification* —
 * KIVO has no transactional email of its own (RECOMMENDATIONS "Configure custom
 * SMTP before you tell anyone the product exists" is still open), no push
 * transport, and no on-call rota. Nothing here changes any of that, and this
 * module must not be mistaken for having changed it.
 *
 * What it does change is the weaker claim that is actually reachable from
 * inside Admin: an operator who opens **any** Admin page, rather than only the
 * Overview, now cannot get through it without seeing that somebody is waiting.
 * Before this, the escalation lived on `/admin` alone, so an operator who went
 * straight to Users or Moderation saw nothing.
 *
 * ## The honest limits, stated because they are easy to miss
 *
 * - It is computed when the Admin layout renders, which in this router is on a
 *   full page load and **not** on a client-side navigation between admin pages
 *   (Partial Rendering — see node_modules/next/dist/docs/01-app/02-guides/
 *   authentication.md, same mechanism that stops a layout being an auth gate).
 *   So it is a reading taken on arrival, not a live counter.
 * - It reaches nobody who is not already looking at Admin. A person locked out
 *   at 02:00 is still waiting until somebody opens a browser.
 *
 * ## A3
 *
 * A role without `canHandleSupport` gets `null` and no query is run at all.
 * `support_requests` is RLS-gated (`support_requests_select_admin`, migration
 * 0055), so querying it as a role without visibility returns zero rows — and a
 * zero here would render as "nobody is waiting", which is exactly the reassuring
 * number produced by an access denial that A3 exists to forbid. A failed read is
 * reported as `unreadable` for the same reason: it must not become a zero.
 */
export type SupportQueueSignal =
  | { status: "clear" }
  | { status: "open"; open: number; oldestIso: string; stale: boolean }
  | { status: "unreadable" };

/** The line at which an open request stops being a queue and starts being a
 *  person locked out of their account overnight. Same threshold, and the same
 *  reasoning, as the Overview's escalation to critical. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function getSupportQueueSignal(role: UserRole | undefined | null): Promise<SupportQueueSignal | null> {
  if (!canHandleSupport(role)) return null;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("support_requests")
    .select("created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true });

  if (error) {
    logError("admin.supportQueueSignal", error);
    return { status: "unreadable" };
  }

  const open = data ?? [];
  if (open.length === 0) return { status: "clear" };

  const oldestIso = open[0].created_at;
  return {
    status: "open",
    open: open.length,
    oldestIso,
    stale: Date.now() - new Date(oldestIso).getTime() > STALE_AFTER_MS,
  };
}
