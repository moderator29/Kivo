import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Server-side Supabase client for Server Components, Server Actions and Route
 * Handlers. Reads and writes the `sb-<ref>-auth-token` cookies that Supabase
 * Auth's session lives in, so every query it issues runs as the signed-in user
 * and RLS resolves them through private.current_profile_id()
 * (supabase/migrations/0053_supabase_auth_identity.sql).
 *
 * This replaced a Clerk `accessToken` bridge. Nothing about the *shape* of this
 * export changed on purpose: ~40 call sites across the app do
 * `const supabase = createServerSupabaseClient()` synchronously, and Next 16's
 * `cookies()` is async. `@supabase/ssr` allows the cookie adapters themselves
 * to be async (see CookieMethodsServer in @supabase/ssr's types), so awaiting
 * the cookie store *inside* getAll/setAll keeps this factory synchronous
 * instead of forcing an `await` onto every one of those call sites.
 *
 * Wrapped in React's `cache()`: nearly every page/action under a request calls
 * this independently (two or three times was typical). Beyond saving the
 * allocation, sharing one instance per request is what lets a Server Action
 * that signs a user in (src/lib/auth-actions.ts) immediately keep using the
 * now-authenticated session in the same request. `cache()` only memoizes within
 * a single request, so nothing about auth freshness changes.
 * See https://react.dev/reference/react/cache.
 */
export const createServerSupabaseClient = cache(function createServerSupabaseClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          return (await cookies()).getAll();
        },
        async setAll(cookiesToSet) {
          try {
            const cookieStore = await cookies();
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. That's fine and expected:
            // the only thing that needs writing here is a refreshed token, and
            // src/proxy.ts already refreshes it (and writes it to both the
            // request and the response) before any Server Component runs.
            // Server Actions and Route Handlers *can* write, so the sign-in /
            // sign-out flows still persist their session through this path.
          }
        },
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
