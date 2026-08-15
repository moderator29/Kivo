import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Server-side Supabase client authorized via Clerk's native third-party
 * integration: the Clerk session token is passed straight through as the
 * accessToken, and Supabase verifies it against Clerk's JWKS. No JWT
 * template, no shared secret.
 *
 * Wrapped in React's `cache()`: nearly every page/action under a request
 * calls this independently (two or three times was typical), each call
 * previously constructing its own client. The client itself is just a thin
 * wrapper with an `accessToken` callback closure — nothing about it varies
 * within a single request — so `cache()` collapses those to one instance per
 * request. Like `getOrCreateProfile` in src/lib/profile.ts, this only
 * memoizes within a single request; a fresh request gets a fresh client, so
 * nothing about auth freshness changes. See RECOMMENDATIONS.md item 78 and
 * https://react.dev/reference/react/cache.
 */
export const createServerSupabaseClient = cache(function createServerSupabaseClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      async accessToken() {
        return (await auth()).getToken();
      },
    },
  );
});

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
