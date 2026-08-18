import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Supabase Auth session refresh for src/proxy.ts.
 *
 * Server Components cannot write cookies, so nothing downstream of this can
 * persist a refreshed access token. This runs first on every matched request,
 * calls `getClaims()` (which refreshes the token when it is about to expire),
 * and writes the resulting cookies to BOTH:
 *
 *   - `request.cookies`, so the Server Components rendering this same request
 *     read the fresh token rather than the stale one they were sent, and
 *   - `supabaseResponse.cookies`, so the browser replaces its copy.
 *
 * Skipping either half is what causes the "users randomly logged out" class of
 * bug. `getClaims()` (not `getSession()`) is what Supabase's own Next.js guide
 * prescribes here: it verifies the JWT signature against the project's
 * published JWKS instead of trusting whatever is in the cookie.
 *
 * The `headers` argument to `setAll` carries the no-store cache headers that
 * must ride along with any response that sets auth cookies — without them a CDN
 * or reverse proxy can cache a `Set-Cookie` and hand one user's session to
 * another.
 */
export async function updateSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            supabaseResponse.headers.set(key, value);
          }
        },
      },
    },
  );

  // Nothing may run between createServerClient and getClaims() — see the
  // warning in Supabase's guide; anything in between can leave the refresh
  // half-applied and is extremely hard to debug afterwards.
  await supabase.auth.getClaims();

  // Must be returned as-is. Building a different response here without copying
  // these cookies across desynchronises browser and server and terminates the
  // session early.
  return supabaseResponse;
}
