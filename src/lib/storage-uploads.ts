import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";
import { logError } from "./log";

/**
 * Superseded-upload cleanup for the two user-owned Storage buckets.
 *
 * `uploadAvatar` and `uploadBackground` both write a fresh timestamped object
 * on every upload — `<auth_user_id>/<timestamp>.<ext>` — and never touched the
 * one they replaced. Both files documented that as a deliberate trade, and the
 * reasoning was sound as far as it went: overwriting in place would break an
 * in-flight request still holding the old public URL.
 *
 * What the trade did not account for is that it has no ceiling. Nothing in the
 * product ever removed one of these objects, so a user who changes their
 * avatar fifty times owns fifty full-size images forever, and the only thing
 * that ever deleted any of them was account deletion. That is unbounded
 * storage growth driven by a single user action, which is exactly the shape of
 * a cost that is invisible until it is large.
 *
 * The fix keeps the reason the trade existed. Rather than deleting the
 * superseded object, this keeps the newest `KEEP_NEWEST` — the live one plus
 * the one immediately before it — so a page rendered a moment ago with the
 * previous URL still resolves, and everything older goes. A stale URL from
 * two changes ago is not a request anybody is still serving.
 *
 * Deliberately best-effort and never blocking: the upload has already
 * succeeded and the profile already points at the new object by the time this
 * runs. A failed sweep is a cost problem, and a sweep that could fail an
 * upload would be a correctness problem. Failures are logged, not returned.
 *
 * Runs on the caller's own session client, not the service role: the buckets'
 * `*_delete_own` policies (migrations 0043/0065, re-keyed to auth.uid() in
 * 0053) already scope deletion to the caller's own folder, so this needs no
 * elevated privilege and cannot reach another user's objects even if the
 * folder were computed wrongly.
 */

/** The live object and one predecessor. Two is the smallest number that keeps
 * a just-rendered page working; more would only extend how long dead files
 * survive. */
const KEEP_NEWEST = 2;

/** A bound on how much one sweep can do, so this can never become a long
 * operation on a folder that has accumulated for months. A folder deeper than
 * this simply takes a few uploads to drain. */
const MAX_LISTED = 100;

export type UploadBucket = "avatars" | "backgrounds";

export async function pruneSupersededUploads(
  supabase: SupabaseClient<Database>,
  bucket: UploadBucket,
  authUserId: string,
  /** The object just uploaded, as a bucket-relative path. Never deleted, even
   * if the listing somehow disagrees about which is newest. */
  keepPath: string,
): Promise<void> {
  try {
    const { data: objects, error } = await supabase.storage.from(bucket).list(authUserId, {
      limit: MAX_LISTED,
      // Filenames are `<epoch-millis>.<ext>`, so name order is upload order.
      sortBy: { column: "name", order: "desc" },
    });

    if (error) {
      logError("storage-uploads.listFailed", error, { bucket });
      return;
    }
    if (!objects || objects.length <= KEEP_NEWEST) return;

    const stale = objects
      .slice(KEEP_NEWEST)
      .map((object) => `${authUserId}/${object.name}`)
      .filter((path) => path !== keepPath);

    if (stale.length === 0) return;

    const { error: removeError } = await supabase.storage.from(bucket).remove(stale);
    if (removeError) logError("storage-uploads.removeFailed", removeError, { bucket });
  } catch (error) {
    // Storage is a network call like any other; a rejected fetch must not
    // surface as a failed upload the user has already completed.
    logError("storage-uploads.pruneThrew", error, { bucket });
  }
}
