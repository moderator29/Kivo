import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * KN-127. Under Clerk, middleware existed only so `auth()` had request context
 * and real enforcement lived at the resource. Under `@supabase/ssr` it is
 * load-bearing for a completely different reason: **it is the only place in the
 * request that can write a cookie.** Server Components cannot. So if the token
 * refresh is missed, or is written to only half of the two places it has to go,
 * a session that expires mid-use is never renewed and the user is silently
 * signed out — the "users randomly logged out" class of bug, which is
 * miserable to reproduce and trivially caused.
 *
 * The item asks for "a request after token expiry that should succeed, not a
 * smoke test". Being honest about what is testable here: driving a genuinely
 * expired-then-refreshed Supabase token needs a real project, a real signed-in
 * user and a wait, none of which exist in a test run (this sandbox cannot even
 * reach *.supabase.co). What IS testable, and is where the bug actually lives,
 * is the contract between `updateSupabaseSession` and the Supabase client: when
 * the client decides to refresh, it hands cookies to `setAll`, and every one of
 * them must end up on BOTH the request (so the Server Components rendering this
 * same request read the fresh token) and the response (so the browser replaces
 * its copy). These tests drive `setAll` directly with the refreshed cookies a
 * real refresh would produce, and assert both halves land.
 *
 * That is the assertion that would have caught every real instance of this bug,
 * including the one Supabase's own guide warns about — building a different
 * response object and losing the cookies on the way out.
 */

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };
type CookieMethods = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: CookieToSet[], headers: Record<string, string>) => void;
};

let captured: CookieMethods | null = null;
const getClaims = vi.fn(async () => ({ data: null, error: null }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieMethods }) => {
    captured = options.cookies;
    return { auth: { getClaims } };
  },
}));

const { updateSupabaseSession } = await import("./proxy");

function makeRequest(cookieHeader?: string) {
  return new NextRequest("https://kivo.test/social", {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe("updateSupabaseSession (KN-127)", () => {
  it("hands the incoming cookies to Supabase so it can see the session at all", async () => {
    const request = makeRequest("sb-access-token=stale; sb-refresh-token=r1");
    await updateSupabaseSession(request);
    expect(captured).not.toBeNull();
    const names = captured!.getAll().map((c) => c.name);
    expect(names).toContain("sb-access-token");
    expect(names).toContain("sb-refresh-token");
  });

  it("calls getClaims — the thing that actually performs the refresh", async () => {
    getClaims.mockClear();
    await updateSupabaseSession(makeRequest("sb-access-token=stale"));
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("writes a refreshed token onto the REQUEST, so this render sees it and not the stale one", async () => {
    const request = makeRequest("sb-access-token=stale");
    // Simulate the refresh: the real client calls setAll from inside getClaims.
    getClaims.mockImplementationOnce(async () => {
      captured!.setAll([{ name: "sb-access-token", value: "fresh", options: { path: "/" } }], {});
      return { data: null, error: null };
    });

    await updateSupabaseSession(request);

    // This is the half that a Server Component reads. Missing it means the
    // page renders as the expired user even though the browser was fixed.
    expect(request.cookies.get("sb-access-token")?.value).toBe("fresh");
  });

  it("writes the refreshed token onto the RESPONSE, so the browser replaces its copy", async () => {
    const request = makeRequest("sb-access-token=stale");
    getClaims.mockImplementationOnce(async () => {
      captured!.setAll(
        [
          { name: "sb-access-token", value: "fresh", options: { path: "/", httpOnly: true } },
          { name: "sb-refresh-token", value: "fresh-r", options: { path: "/" } },
        ],
        {},
      );
      return { data: null, error: null };
    });

    const response = await updateSupabaseSession(request);

    // Missing this half is the "logged out on the next request" bug: the render
    // succeeds, then the browser sends the expired token back forever.
    expect(response.cookies.get("sb-access-token")?.value).toBe("fresh");
    expect(response.cookies.get("sb-refresh-token")?.value).toBe("fresh-r");
  });

  it("carries the cache headers Supabase supplies onto the response", async () => {
    const request = makeRequest("sb-access-token=stale");
    getClaims.mockImplementationOnce(async () => {
      captured!.setAll([{ name: "sb-access-token", value: "fresh" }], {
        // Without these riding along, a CDN can cache a Set-Cookie and hand one
        // user's session to another.
        "cache-control": "private, no-cache, no-store, max-age=0, must-revalidate",
      });
      return { data: null, error: null };
    });

    const response = await updateSupabaseSession(request);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store, max-age=0, must-revalidate",
    );
  });

  it("stamps the path header the auth gate builds its return link from (KN-123)", async () => {
    const request = new NextRequest("https://kivo.test/matches/abc?tab=room");
    await updateSupabaseSession(request);
    expect(request.headers.get("x-kivo-path")).toBe("/matches/abc?tab=room");
  });

  it("overwrites a client-supplied path header rather than trusting it", async () => {
    const request = new NextRequest("https://kivo.test/saved", {
      headers: { "x-kivo-path": "/evil" },
    });
    await updateSupabaseSession(request);
    expect(request.headers.get("x-kivo-path")).toBe("/saved");
  });
});
