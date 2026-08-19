import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/types";
import { notificationDedupeMode } from "@/lib/notification-registry";
import { logError } from "@/lib/log";

/**
 * The database's own insert shape rather than `notification-payloads`'
 * narrower one, so producers that add `quiet_until` (migration 0088) by
 * spreading a built row can pass the result straight through without a cast.
 * `buildNotification`'s return value is assignable to this.
 */
type NotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];

/**
 * The one place a notification is actually written.
 *
 * Every producer used to call `.insert()` itself, which meant every producer
 * independently decided what happens when the same notification is produced
 * twice — and, until a seeded account was actually looked at, none of them had
 * decided anything. That account's bell held six fantasy rows where three
 * belonged, one of them reporting a gameweek total (28) that existed nowhere
 * else in the product, sitting above the correct one (36).
 *
 * The fix is not "add a key and ignore duplicates", because that keeps the
 * stale 28 and drops the corrected 36. It is that **the right resolution
 * depends on why the second write happened**, which is a property of the
 * notification's type — so it is declared once in the registry
 * (`NOTIFICATION_DEDUPE_MODE`) and applied here, rather than being got right
 * from first principles at each call site.
 *
 *   none       plain insert; two occurrences are two notifications
 *   ignore     first write wins; a re-run re-reads an event, it does not repeat it
 *   supersede  latest write wins and re-surfaces, but only if it actually differs
 *
 * Rows are grouped by mode rather than written one at a time, so a fan-out to
 * fifty thousand followers stays the same number of round trips it was before.
 */

type Client = SupabaseClient<Database>;

export async function writeNotifications(supabase: Client, rows: NotificationInsert[]): Promise<void> {
  if (rows.length === 0) return;

  const plain: NotificationInsert[] = [];
  const ignore: NotificationInsert[] = [];
  const supersede: NotificationInsert[] = [];

  for (const row of rows) {
    // A row with no key cannot conflict with anything, so it is written
    // plainly whatever its type says. This keeps the two halves independent:
    // a producer that has no stable identity to offer is never forced to
    // invent one just because its type is marked deduplicating.
    if (!row.dedupe_key) {
      plain.push(row);
      continue;
    }
    const mode = notificationDedupeMode(row.type);
    if (mode === "supersede") supersede.push(row);
    else if (mode === "ignore") ignore.push(row);
    else plain.push(row);
  }

  await Promise.all([
    writePlain(supabase, plain),
    writeIgnoringDuplicates(supabase, ignore),
    writeSuperseding(supabase, supersede),
  ]);
}

async function writePlain(supabase: Client, rows: NotificationInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) logError("notification-write.insert", error, { count: rows.length });
}

async function writeIgnoringDuplicates(supabase: Client, rows: NotificationInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("notifications")
    .upsert(rows, { onConflict: "profile_id,dedupe_key", ignoreDuplicates: true });
  if (error) logError("notification-write.upsertIgnoring", error, { count: rows.length });
}

/**
 * Superseding goes through an RPC rather than an upsert because the resolution
 * needed is `DO UPDATE ... WHERE the payload actually changed`, and PostgREST's
 * upsert cannot express the WHERE. Without that condition an ordinary re-sync
 * would bump every full-time notification back to the top of the bell and mark
 * it unread again — a re-notification carrying no new information, which is the
 * exact spam this mechanism exists to prevent. See migration 0105.
 */
async function writeSuperseding(supabase: Client, rows: NotificationInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.rpc("upsert_notifications_superseding", {
    p_rows: rows as unknown as Json,
  });
  if (error) logError("notification-write.upsertSuperseding", error, { count: rows.length });
}
