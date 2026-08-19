"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { isKivoBackgroundId } from "@/lib/kivo-assets";
import { checkRateLimit } from "@/lib/rate-limit";
import { pruneSupersededUploads } from "@/lib/storage-uploads";
import { logError } from "@/lib/log";

// Matches the `backgrounds` Storage bucket's own file_size_limit /
// allowed_mime_types (supabase/migrations/0065_profile_backgrounds_and_display_name.sql)
// — checked here too so a rejected upload fails fast with a real message
// instead of a raw storage error, exactly as uploadAvatar
// (src/app/(app)/settings/avatar-actions.ts) does for the `avatars` bucket.
//
// GIF is deliberately absent where the avatar list has it: a cover renders at
// full page width behind text, and an animating one there is a legibility
// problem, not a feature. The bucket's own allowed_mime_types agrees, so this
// is not a UI-only restriction.
const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;
const ALLOWED_BACKGROUND_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export async function selectBackground(backgroundId: string) {
  if (!isKivoBackgroundId(backgroundId)) {
    return { error: "That's not a KIVO background." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "update_appearance", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  // background_uploaded_url has to be cleared in the same write: migration
  // 0065's profiles_background_source_exclusive rejects a row holding both, so
  // "switch back to a KIVO cover" is one statement, not two. The user's own
  // uploaded object stays in Storage — switching away just stops referencing
  // it, the same non-deletion rule selectKivoAvatar documents.
  const { error } = await supabase
    .from("profiles")
    .update({ background_id: backgroundId, background_uploaded_url: null })
    .eq("id", profile.id);

  if (error) {
    logError("profile.background-actions.selectProfileBackground", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}

/**
 * Uploads a real cover image to the `backgrounds` Storage bucket at
 * `<auth_user_id>/<timestamp>.<ext>` — the folder-per-user layout the bucket's
 * own RLS policies (backgrounds_insert_own etc., migration 0065) key off by
 * comparing the first path segment to auth.uid()::text — then makes it the
 * active cover. Deliberately identical in shape to `uploadAvatar`: a fresh
 * timestamped path every time (never an overwrite, so an in-flight request
 * holding the old URL is never broken out from under it), and no cleanup of
 * the superseded object.
 *
 * Objects older than the immediately-previous one are swept afterwards by
 * `pruneSupersededUploads`, exactly as `uploadAvatar` now does: keeping every
 * superseded cover forever was a cost with no ceiling. What this is also NOT
 * allowed to leave behind is an undeletable account: Supabase refuses to
 * delete an auth user who still owns Storage objects, so `deleteAccount`
 * (src/app/(app)/settings/actions.ts) sweeps this bucket alongside `avatars`.
 */
export async function uploadBackground(formData: FormData) {
  const file = formData.get("background");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }

  const ext = ALLOWED_BACKGROUND_MIME_TYPES[file.type];
  if (!ext) {
    return { error: "Use a PNG, JPEG or WEBP image." };
  }
  if (file.size > MAX_BACKGROUND_BYTES) {
    return { error: "Image must be 5MB or smaller." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  // Same bound as uploadAvatar, and for the same reason — see its comment.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "upload_background", 5, 600);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();

  // The folder name IS the ownership check (backgrounds_insert_own compares
  // (storage.foldername(name))[1] to auth.uid()::text). A profile with no
  // auth_user_id cannot hold a session at all, so there is no id to write
  // under — bail rather than build a path the policy is guaranteed to reject.
  if (!profile.auth_user_id) {
    return { error: "Something went wrong. Try again." };
  }
  const path = `${profile.auth_user_id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("backgrounds").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    logError("profile.background-actions.uploadProfileBackground", uploadError);
    return { error: "Upload failed. Try again." };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("backgrounds").getPublicUrl(path);

  const { error } = await supabase
    .from("profiles")
    .update({ background_uploaded_url: publicUrl, background_id: null })
    .eq("id", profile.id);

  if (error) {
    logError("profile.background-actions.saveUploadedBackground", error);
    return { error: "Something went wrong. Try again." };
  }

  await pruneSupersededUploads(supabase, "backgrounds", profile.auth_user_id, path);

  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null, url: publicUrl };
}

/** No default background is ever forced (this feature's own spec) — this is
 * the explicit "go back to having none" action, distinct from selecting one
 * of the ten real ids or uploading your own. Clears both sources. */
export async function clearBackground() {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "update_appearance", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ background_id: null, background_uploaded_url: null })
    .eq("id", profile.id);

  if (error) {
    logError("profile.background-actions.clearProfileBackground", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}
