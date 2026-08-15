import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Server-side Supabase client authorized via Clerk's native third-party
 * integration: the Clerk session token is passed straight through as the
 * accessToken, and Supabase verifies it against Clerk's JWKS. No JWT
 * template, no shared secret.
 */
export function createServerSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      async accessToken() {
        return (await auth()).getToken();
      },
    },
  );
}

/**
 * Service-role client for trusted server contexts only (webhooks, admin
 * mutations, background jobs). Bypasses RLS — never import this into
 * anything reachable from a user request without an explicit role check.
 */
export function createServiceRoleSupabaseClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}
