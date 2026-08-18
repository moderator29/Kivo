import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseDouble } from "@/lib/supabase/query-double";

/**
 * KN-130. `signOutOtherDevices`'s scoping.
 *
 * One argument decides whether this signs out the user's other devices or
 * signs out everything including the session making the request — and the two
 * differ by a single string. Getting it wrong looks identical in the UI
 * (the call succeeds) right up until the user is thrown out of the page they
 * are standing on, which is both alarming and, on a security screen, exactly
 * the wrong signal.
 *
 * There is no database row to assert against, so the scope argument itself is
 * the assertion.
 */

let double: ReturnType<typeof createSupabaseDouble>;

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => double.client,
}));

async function signOutOthers() {
  const { signOutOtherDevices } = await import("./session-actions");
  return signOutOtherDevices();
}

beforeEach(() => {
  vi.resetModules();
});

describe("signOutOtherDevices", () => {
  it("signs out with scope 'others', keeping the caller's own session", async () => {
    double = createSupabaseDouble({
      "auth.getUser": { data: { user: { id: "user-1" } }, error: null },
      "auth.signOut": { error: null },
    });

    const result = await signOutOthers();

    expect(result.error).toBeNull();
    const call = double.calls.find((entry) => entry.table === "auth.signOut");
    expect(call?.chain).toEqual(["others"]);
  });

  it("refuses a signed-out caller without calling signOut at all", async () => {
    double = createSupabaseDouble({
      "auth.getUser": { data: { user: null }, error: null },
    });

    const result = await signOutOthers();

    expect(result.error).toMatch(/signed in/i);
    expect(double.calls.some((entry) => entry.table === "auth.signOut")).toBe(false);
  });

  it("treats a getUser error as signed out rather than proceeding", async () => {
    double = createSupabaseDouble({
      "auth.getUser": { data: { user: null }, error: { message: "jwt expired" } },
    });

    const result = await signOutOthers();

    expect(result.error).toMatch(/signed in/i);
    expect(double.calls.some((entry) => entry.table === "auth.signOut")).toBe(false);
  });

  it("reports a failure instead of claiming the other devices were signed out", async () => {
    double = createSupabaseDouble({
      "auth.getUser": { data: { user: { id: "user-1" } }, error: null },
      "auth.signOut": { error: { message: "network" } },
    });

    const result = await signOutOthers();

    expect(result.error).toMatch(/something went wrong/i);
  });
});
