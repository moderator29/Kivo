"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";

const MAX_POST_LENGTH = 2000;

export async function createPost(formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body || body.length > MAX_POST_LENGTH) {
    return { error: "Post must be between 1 and 2000 characters." };
  }

  const profile = await getOrCreateProfile();
  if (!profile) {
    return { error: "You must be signed in to post." };
  }

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("posts").insert({ author_profile_id: profile.id, body });

  if (error) {
    console.error("Failed to create post", error);
    return { error: "Couldn't publish your post — try again." };
  }

  revalidatePath("/social");
  return { error: null };
}

export async function toggleLike(postId: string, alreadyLiked: boolean) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to react." };

  const supabase = createServerSupabaseClient();

  const { error } = alreadyLiked
    ? await supabase
        .from("reactions")
        .delete()
        .eq("target_type", "post")
        .eq("target_id", postId)
        .eq("profile_id", profile.id)
    : await supabase.from("reactions").insert({
        target_type: "post",
        target_id: postId,
        profile_id: profile.id,
        reaction_type: "like",
      });

  if (error) {
    console.error("Failed to toggle reaction", error);
    return { error: "Couldn't update your reaction." };
  }

  revalidatePath("/social");
  return { error: null };
}
