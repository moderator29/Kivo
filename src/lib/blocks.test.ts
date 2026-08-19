import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: () => ({}) }));
vi.mock("@/lib/profile", () => ({ getOrCreateProfile: async () => null }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const { notificationIsFromBlockedActor } = await import("@/lib/blocks");

/**
 * The read-side half of a block, tested on the predicate that decides it.
 *
 * The interesting cases are the ones that must NOT be filtered: a block
 * silences a person, and a product that let it silence a goal alert would be
 * quietly broken in a way nobody would attribute to blocking.
 */
describe("notificationIsFromBlockedActor", () => {
  const blocked = new Set(["troll"]);

  it("drops a like from a blocked account", () => {
    expect(notificationIsFromBlockedActor({ liker_username: "troll", post_id: "p" }, blocked)).toBe(true);
  });

  it("drops a comment, a reply and a follow from a blocked account", () => {
    expect(notificationIsFromBlockedActor({ commenter_username: "troll" }, blocked)).toBe(true);
    expect(notificationIsFromBlockedActor({ replier_username: "troll" }, blocked)).toBe(true);
    expect(notificationIsFromBlockedActor({ follower_username: "troll" }, blocked)).toBe(true);
  });

  it("keeps the same action from anybody else", () => {
    expect(notificationIsFromBlockedActor({ liker_username: "ada" }, blocked)).toBe(false);
  });

  it("never touches a match notification", () => {
    // No actor key at all — a goal is not a person, and blocking someone must
    // not make a fixture alert disappear.
    expect(
      notificationIsFromBlockedActor({ fixture_id: "f1", summary: "Goal for Arsenal (12')" }, blocked),
    ).toBe(false);
  });

  it("is a no-op when nothing is blocked", () => {
    expect(notificationIsFromBlockedActor({ liker_username: "troll" }, new Set())).toBe(false);
  });

  it("survives a malformed or absent payload", () => {
    expect(notificationIsFromBlockedActor(null, blocked)).toBe(false);
    expect(notificationIsFromBlockedActor("not an object", blocked)).toBe(false);
    expect(notificationIsFromBlockedActor({ liker_username: 42 }, blocked)).toBe(false);
  });

  it("matches the whole username, not a prefix", () => {
    expect(notificationIsFromBlockedActor({ liker_username: "trolley" }, blocked)).toBe(false);
  });
});
