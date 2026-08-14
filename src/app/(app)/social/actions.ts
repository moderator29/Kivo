"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getOrCreateProfile } from "@/lib/profile";
import { awardBadge, awardXp } from "@/lib/rewards";
import { checkRateLimit } from "@/lib/rate-limit";

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

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "create_post", 5, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

  // Optional match-room scoping: PostComposer includes this as a hidden field
  // when it's rendered inside Match Centre's Room tab (see MatchRoomTab). Left
  // unset, the insert lands as a normal, unscoped community post.
  const fixtureId = String(formData.get("fixture_id") ?? "").trim() || null;

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("posts").insert({ author_profile_id: profile.id, body, fixture_id: fixtureId });

  if (error) {
    console.error("Failed to create post", error);
    return { error: "Couldn't publish your post. Try again." };
  }

  // awardBadge is a harmless no-op on repeat posts (unique constraint on
  // user_badges swallows the duplicate) — no need to check "is this their first."
  await Promise.all([awardXp(profile.id, 2, "Posted in the community"), awardBadge(profile.id, "first_post")]);

  revalidatePath("/social");
  if (fixtureId) revalidatePath(`/matches/${fixtureId}`);
  return { error: null };
}

export async function toggleLike(postId: string, alreadyLiked: boolean) {
  const profile = await getOrCreateProfile();
  if (!profile) return { error: "You must be signed in to react." };

  const rateLimit = await checkRateLimit(`user:${profile.id}`, "toggle_like", 30, 60);
  if (!rateLimit.ok) return { error: rateLimit.error };

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

  if (!alreadyLiked) {
    await notifyPostLiked(postId, profile);
  }

  revalidatePath("/social");
  return { error: null };
}

/**
 * notifications has no client-facing insert policy by design (system-generated
 * only) — this is the system doing the generating, so it goes through the
 * service-role client deliberately, not as an RLS workaround.
 */
async function notifyPostLiked(postId: string, liker: { id: string; username: string; display_name: string | null }) {
  const supabase = createServerSupabaseClient();
  const { data: post } = await supabase
    .from("posts")
    .select("author_profile_id, fixture_id")
    .eq("id", postId)
    .maybeSingle();

  if (!post || post.author_profile_id === liker.id) return;

  const serviceClient = createServiceRoleSupabaseClient();
  const { error } = await serviceClient.from("notifications").insert({
    profile_id: post.author_profile_id,
    type: "post_like",
    // fixture_id (nullable) lets the bell/notifications page route back to the
    // fixture's Match Centre Room tab for a room post, vs. /social for a
    // general one — see notificationHref() in lib/notification-registry.ts.
    payload: {
      post_id: postId,
      fixture_id: post.fixture_id,
      liker_username: liker.username,
      liker_display_name: liker.display_name,
    },
  });

  if (error) console.error("Failed to create like notification", error);
}
