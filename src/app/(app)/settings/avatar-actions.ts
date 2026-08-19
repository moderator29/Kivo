"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { isKivoAvatarId } from "@/lib/kivo-assets";
import { checkRateLimit } from "@/lib/rate-limit";
import { pruneSupersededUploads } from "@/lib/storage-uploads";
import { logError } from "@/lib/log";

// Matches the `avatars` Storage bucket's own file_size_limit/allowed_mime_types
// (supabase/migrations/0043_kivo_avatar_background_system.sql) — checked here
// too so a rejected upload fails fast with a real message instead of a raw
// storage error, same "validate client-side shape before the round trip"
// reasoning as updateProfileDetails' MAX_BIO_LENGTH check just above it in
// actions.ts.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Selects one of the confirmed-clean KIVO avatars (RECOMMENDATIONS items
 * 231/232, KIVO_AVATAR_IDS) as the active avatar. Clears avatar_uploaded_url
 * (required by profiles_avatar_type_fields_match) but never deletes the
 * underlying Storage object if the user had one — switching away just stops
 * referencing it as active, per this feature's own spec. There is no
 * "restore my old upload without re-uploading" path, deliberately — see
 * profiles_avatar_type_fields_match's null-when-inactive shape — and an
 * upload only survives until two further uploads supersede it
 * (pruneSupersededUploads), so switching away is not a way to keep one.
 */
export async function selectKivoAvatar(kivoId: string) {
  if (!isKivoAvatarId(kivoId)) {
    return { error: "That's not a KIVO avatar." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  // Cheap write, but still a write on a public endpoint with no other bound.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "update_appearance", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_type: "kivo", avatar_kivo_id: kivoId, avatar_uploaded_url: null })
    .eq("id", profile.id);

  if (error) {
    logError("settings.avatar-actions.selectKivoAvatar", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}

/**
 * Uploads a real user photo to the `avatars` Storage bucket at
 * `<auth_user_id>/<timestamp>.<ext>` — the folder-per-user layout the
 * bucket's own RLS policies (avatars_insert_own etc.) key off by comparing
 * the first path segment to auth.uid()::text
 * (supabase/migrations/0053_supabase_auth_identity.sql) — then makes it the
 * active avatar. Never overwrites a prior upload (a fresh timestamped path
 * every time), so an in-flight request referencing the old URL is never broken
 * out from under it.
 *
 * Anything older than the immediately-previous object is then swept by
 * `pruneSupersededUploads`. The never-delete rule this used to document was a
 * deliberate trade with no ceiling: nothing in the product ever removed one of
 * these files, so a user who changed their avatar fifty times owned fifty
 * full-size images forever. Keeping one predecessor preserves the reason the
 * trade existed while giving it a bound.
 */
export async function uploadAvatar(formData: FormData) {
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }

  const ext = ALLOWED_AVATAR_MIME_TYPES[file.type];
  if (!ext) {
    return { error: "Use a PNG, JPEG, WEBP or GIF image." };
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: "Image must be 5MB or smaller." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  // An upload is the most expensive thing an ordinary account can ask this
  // product to do: 5MB of transfer and a permanent object, on an endpoint that
  // had no bound of any kind. Ten minutes for five uploads is far more than
  // choosing an avatar takes and far less than a script needs to be a problem.
  const rateLimit = await checkRateLimit(`user:${profile.id}`, "upload_avatar", 5, 600);
  if (!rateLimit.ok) return { error: rateLimit.error };

  const supabase = createServerSupabaseClient();

  // The folder name IS the ownership check: avatars_insert_own compares
  // (storage.foldername(name))[1] to auth.uid()::text. A profile without an
  // auth_user_id is a pre-migration Clerk-era row that cannot hold a session
  // at all, so there is no id to write under — bail rather than build a path
  // the policy is guaranteed to reject with a raw storage error.
  if (!profile.auth_user_id) {
    return { error: "Something went wrong. Try again." };
  }
  const path = `${profile.auth_user_id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    logError("settings.avatar-actions.uploadAvatar", uploadError);
    return { error: "Upload failed. Try again." };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_type: "uploaded", avatar_uploaded_url: publicUrl, avatar_kivo_id: null })
    .eq("id", profile.id);

  if (error) {
    logError("settings.avatar-actions.saveUploadedAvatar", error);
    return { error: "Something went wrong. Try again." };
  }

  // Only after the profile points at the new object: if this ran first, a
  // failure between the two would leave the row referencing a file that had
  // just been deleted. See pruneSupersededUploads for why one predecessor is
  // kept rather than none.
  await pruneSupersededUploads(supabase, "avatars", profile.auth_user_id, path);

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}
