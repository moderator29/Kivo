import { headers } from "next/headers";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import { randomKivoAvatarId } from "@/lib/kivo-assets";

export async function POST(req: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("CLERK_WEBHOOK_SECRET is not configured", { status: 500 });
  }

  const headerList = await headers();
  const svixId = headerList.get("svix-id");
  const svixTimestamp = headerList.get("svix-timestamp");
  const svixSignature = headerList.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  const payload = await req.text();

  let event: WebhookEvent;
  try {
    event = new Webhook(webhookSecret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch {
    return new Response("Invalid webhook signature", { status: 400 });
  }

  const supabase = createServiceRoleSupabaseClient();

  switch (event.type) {
    case "user.created": {
      const user = event.data;

      // profiles.username is NOT NULL/UNIQUE and Clerk sign-up doesn't collect a KIVO
      // handle, so a placeholder derived from the (already-unique) Clerk id is assigned
      // here and replaced during onboarding — never colliding, never blocking signup.
      // Email is deliberately not stored: Clerk is the single source of truth for it.
      //
      // avatar_type/avatar_kivo_id: a random confirmed-clean KIVO avatar
      // (RECOMMENDATIONS.md items 231/232, KIVO_AVATAR_IDS) is assigned once,
      // here, at profile creation — never re-rolled on any later webhook
      // event or login. See getOrCreateProfile() in src/lib/profile.ts for
      // the same assignment on its own (fallback) profile-creation path.
      const { error } = await supabase.from("profiles").insert({
        clerk_user_id: user.id,
        username: `user_${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`,
        display_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
        avatar_url: user.image_url ?? null,
        avatar_type: "kivo",
        avatar_kivo_id: randomKivoAvatarId(),
      });

      // Duplicate-key is expected on webhook retries (Clerk does not guarantee
      // at-most-once delivery) — the profile already exists, nothing to do.
      if (error && error.code !== "23505") {
        logError("clerk-webhook.user.created", error, { clerkUserId: user.id });
        return new Response("Failed to create profile", { status: 500 });
      }
      break;
    }
    case "user.updated": {
      const user = event.data;

      // Re-audited 2026-08-17 for the KIVO avatar/background editor: display_name
      // still has no KIVO-side editor, so it's still safe to keep unconditionally
      // overwriting from Clerk here. avatar_url is different now -- it stays a
      // pure mirror of Clerk's own OAuth/Clerk-hosted photo (a separate concept
      // from the KIVO-native avatar), so it keeps syncing unconditionally too.
      // But avatar_type/avatar_kivo_id/avatar_uploaded_url are KIVO-native
      // fields the user now controls directly via /settings (see
      // src/app/(app)/settings/avatar-actions.ts) -- an unrelated Clerk-side
      // profile change (name, photo, etc.) must never silently reset them, so
      // this update only ever touches display_name/avatar_url, never those
      // three columns.
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
          avatar_url: user.image_url ?? null,
        })
        .eq("clerk_user_id", user.id);

      if (error) {
        logError("clerk-webhook.user.updated", error, { clerkUserId: user.id });
        return new Response("Failed to update profile", { status: 500 });
      }
      break;
    }
    case "user.deleted": {
      if (event.data.id) {
        const { error } = await supabase.from("profiles").delete().eq("clerk_user_id", event.data.id);
        if (error) {
          logError("clerk-webhook.user.deleted", error, { clerkUserId: event.data.id });
          return new Response("Failed to delete profile", { status: 500 });
        }
      }
      break;
    }
    default:
      break;
  }

  return new Response("ok", { status: 200 });
}
