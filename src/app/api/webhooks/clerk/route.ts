import { headers } from "next/headers";
import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

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
        logError("clerk-webhook.user.created", error, { clerkUserId: user.id });
        return new Response("Failed to create profile", { status: 500 });
      }
      break;
    }
    case "user.updated": {
      const user = event.data;

      // Unconditional overwrite is safe today (RECOMMENDATIONS item 203,
      // re-checked 2026-08-15): profiles.display_name/avatar_url have no
      // KIVO-side editor anywhere in the app -- settings' ProfileDetailsEditor
      // only writes bio/country (src/app/(app)/settings/actions.ts), so there
      // is no user-side edit for a Clerk sync to revert yet. If display_name
      // or avatar_url ever gets its own editor, this needs to stop
      // unconditionally overwriting an already-set value (e.g. only fill on
      // first creation, or gate on a has_custom_display_name-style flag) --
      // re-audit this handler before shipping that editor, not after.
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
