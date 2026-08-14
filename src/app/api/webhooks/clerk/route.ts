import { headers } from "next/headers";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

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
      const { error } = await supabase.from("profiles").insert({
        clerk_user_id: user.id,
        username: `user_${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`,
        display_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
        avatar_url: user.image_url ?? null,
      });

      // Duplicate-key is expected on webhook retries (Clerk does not guarantee
      // at-most-once delivery) — the profile already exists, nothing to do.
      if (error && error.code !== "23505") {
        console.error("Failed to create profile from Clerk webhook", error);
        return new Response("Failed to create profile", { status: 500 });
      }
      break;
    }
    case "user.updated": {
      const user = event.data;

      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: [user.first_name, user.last_name].filter(Boolean).join(" ") || null,
          avatar_url: user.image_url ?? null,
        })
        .eq("clerk_user_id", user.id);

      if (error) {
        console.error("Failed to update profile from Clerk webhook", error);
        return new Response("Failed to update profile", { status: 500 });
      }
      break;
    }
    case "user.deleted": {
      if (event.data.id) {
        const { error } = await supabase.from("profiles").delete().eq("clerk_user_id", event.data.id);
        if (error) {
          console.error("Failed to delete profile from Clerk webhook", error);
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
