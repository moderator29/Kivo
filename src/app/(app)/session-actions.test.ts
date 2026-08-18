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
/** Which slots the device is holding, and which ones got signed out. */
let slotsHeld: number[] = [];
const signedOutSlots: number[] = [];

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => double.client,
}));
vi.mock("@/lib/supabase/stored-accounts", () => ({
  occupiedSlots: async () => slotsHeld,
  signOutStoredSlot: async (slot: number) => {
    signedOutSlots.push(slot);
    return { error: null };
  },
}));

async function signOutOthers() {
  const { signOutOtherDevices } = await import("./session-actions");
  return signOutOtherDevices();
}

beforeEach(() => {
  vi.resetModules();
  slotsHeld = [];
  signedOutSlots.length = 0;
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

/**
 * The security half of multi-account switching.
 *
 * A stored account is a live credential, and the switcher — the only place it
 * can be revoked from — lives inside the signed-in app. If "Sign out" left the
 * stored ones behind, a device whose owner had deliberately signed out would
 * still be holding working sessions for other accounts with no screen in the
 * product from which to reach them. That failure is completely invisible in
 * the UI, which is exactly why it gets a test.
 */
describe("signOut", () => {
  it("signs out the account you're using with scope 'local', not everyone's devices", async () => {
    double = createSupabaseDouble({ "auth.signOut": { error: null } });

    const { signOut } = await import("./session-actions");
    await signOut();

    const call = double.calls.find((entry) => entry.table === "auth.signOut");
    expect(call?.chain).toEqual(["local"]);
  });

  it("revokes every other account stored on this device too", async () => {
    double = createSupabaseDouble({ "auth.signOut": { error: null } });
    slotsHeld = [0, 2];

    const { signOut } = await import("./session-actions");
    await signOut();

    expect(signedOutSlots).toEqual([0, 2]);
  });

  it("does nothing extra when no other account is stored", async () => {
    double = createSupabaseDouble({ "auth.signOut": { error: null } });

    const { signOut } = await import("./session-actions");
    await signOut();

    expect(signedOutSlots).toEqual([]);
  });
});
