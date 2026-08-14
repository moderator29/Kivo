import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "./supabase/server";
import { isClerkConfigured } from "./clerk";
import type { Database } from "./supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Guarantees the signed-in Clerk user has a KIVO profile row, creating one if
 * the Clerk webhook hasn't fired yet (e.g. CLERK_WEBHOOK_SECRET not configured
 * in this environment) — the app must not break just because a webhook is
 * unwired. Uses the service-role client only for this one fallback path.
 */
export async function getOrCreateProfile(): Promise<Profile | null> {
  // currentUser() throws if clerkMiddleware() never ran for this request (true
  // whenever Clerk is unconfigured — see src/proxy.ts). Next.js renders a route
  // segment's page in parallel with its layout, so a protected page can start
  // rendering (and call this) before the layout's own redirect takes effect;
  // returning null here instead of throwing keeps that a clean no-op.
  if (!isClerkConfigured()) return null;

  const user = await currentUser();
  if (!user) return null;

  const supabase = createServerSupabaseClient();
  const { data: existing } = await supabase.from("profiles").select("*").eq("clerk_user_id", user.id).maybeSingle();

  if (existing) return existing;

  const serviceClient = createServiceRoleSupabaseClient();
  const { data: created, error } = await serviceClient
    .from("profiles")
    .insert({
      clerk_user_id: user.id,
      username: `user_${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(-10)}`,
      display_name: [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
      avatar_url: user.imageUrl ?? null,
    })
    .select("*")
    .single();

  if (error) {
    // Concurrent requests (two tabs, two route segments) can both miss the
    // SELECT above and race to insert — the loser hits a unique violation,
    // same as the webhook's retry path. Re-fetch instead of treating a
    // signed-in user as profile-less.
    if (error.code === "23505") {
      const { data: retried } = await supabase.from("profiles").select("*").eq("clerk_user_id", user.id).maybeSingle();
      return retried;
    }
    console.error("Failed to fallback-create profile", error);
    return null;
  }

  return created;
}
