"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { isKivoAvatarId } from "@/lib/kivo-assets";

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
 * referencing it as active, per this feature's own spec. The user's own
 * uploaded image is therefore still sitting in Storage if they switch back
 * to "Upload your own photo" and upload again; there is no separate
 * "restore my old upload without re-uploading" path, deliberately — see
 * profiles_avatar_type_fields_match's null-when-inactive shape.
 */
export async function selectKivoAvatar(kivoId: string) {
  if (!isKivoAvatarId(kivoId)) {
    return { error: "That's not a KIVO avatar." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in." };

  const supabase = createServerSupabaseClient();
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_type: "kivo", avatar_kivo_id: kivoId, avatar_uploaded_url: null })
    .eq("id", profile.id);

  if (error) {
    console.error("Failed to select KIVO avatar", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}

/**
 * Uploads a real user photo to the `avatars` Storage bucket at
 * `<clerk_user_id>/<timestamp>.<ext>` — the folder-per-user layout the
 * bucket's own RLS policies (avatars_insert_own etc.) key off via
 * private.current_clerk_user_id() — then makes it the active avatar. Never
 * overwrites/deletes a prior upload (a fresh timestamped path every time),
 * so an in-flight request referencing the old URL is never broken out from
 * under it; an old, no-longer-referenced object is just left in place (this
 * feature deliberately doesn't build a cleanup path — see this action's
 * module doc and RECOMMENDATIONS.md for the follow-up idea).
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

  const supabase = createServerSupabaseClient();
  const path = `${profile.clerk_user_id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    console.error("Failed to upload avatar", uploadError);
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
    console.error("Failed to save uploaded avatar", error);
    return { error: "Something went wrong. Try again." };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  revalidatePath(`/u/${profile.username}`);
  return { error: null };
}
