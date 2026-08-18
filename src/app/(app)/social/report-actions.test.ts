import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseDouble } from "@/lib/supabase/query-double";

/**
 * KN-130. `reportContent`'s input handling and the snapshot it captures.
 *
 * Two things are actually at stake here, and neither is obvious from the
 * function's size. The reason string is written straight into a column with a
 * `char_length between 1 and 1000` check constraint (migration 0001), so a
 * caller-supplied reason that is empty or oversized either produces a raw
 * Postgres error or, worse, a report nobody can read. And the
 * `content_snapshot` is the *only* record of what was reported once a
 * moderator hard-deletes the target — if it silently becomes null, the
 * moderation queue reviews reports about content that no longer exists.
 *
 * The reporter id is asserted to come from the session rather than the
 * arguments, because a server action is a public endpoint and the client
 * passes the target, not the reporter.
 */

const profileMock = vi.fn();
let double: ReturnType<typeof createSupabaseDouble>;

vi.mock("@/lib/profile", () => ({ getOrCreateProfile: () => profileMock() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => double.client,
}));

const VIEWER = { id: "profile-1" };

async function report(reason = "Spam", targetType: "post" | "comment" | "profile" = "post", targetId = "post-1") {
  const { reportContent } = await import("./report-actions");
  return reportContent(targetType, targetId, reason);
}

beforeEach(() => {
  vi.resetModules();
  profileMock.mockReset().mockResolvedValue(VIEWER);
});

describe("reportContent input handling", () => {
  it.each([
    ["an empty reason", ""],
    ["whitespace pretending to be a reason", "    "],
    ["a reason past the column's 1000-character constraint", "x".repeat(1001)],
  ])("refuses %s before doing anything else", async (_label, reason) => {
    double = createSupabaseDouble({});

    const result = await report(reason);

    expect(result.error).toMatch(/choose a reason/i);
    // Validated before the session is even resolved, so a malformed request
    // costs nothing.
    expect(double.calls).toHaveLength(0);
  });

  it("accepts a reason of exactly the maximum length", async () => {
    double = createSupabaseDouble({
      posts: { data: { body: "b", created_at: "t", fixture_id: null, author: null }, error: null },
      reports: { data: null, error: null },
    });

    const result = await report("x".repeat(1000));

    expect(result.error).toBeNull();
  });

  it("refuses a signed-out reporter", async () => {
    profileMock.mockResolvedValue(null);
    double = createSupabaseDouble({});

    const result = await report();

    expect(result.error).toMatch(/signed in/i);
    expect(double.wrote("reports")).toBe(false);
  });
});

describe("reportContent snapshot capture", () => {
  it("stores the reporter from the session, and the trimmed reason", async () => {
    double = createSupabaseDouble({
      posts: {
        data: { body: "the post", created_at: "2026-08-18T00:00:00Z", fixture_id: "f1", author: { username: "u", display_name: "U" } },
        error: null,
      },
      reports: { data: null, error: null },
    });

    await report("  harassment  ", "post", "post-7");

    const write = double.calls.find((call) => call.table === "reports");
    expect(write?.payload).toMatchObject({
      reporter_profile_id: VIEWER.id,
      target_type: "post",
      target_id: "post-7",
      reason: "harassment",
      status: "pending",
    });
    expect((write?.payload as { content_snapshot: { body: string } }).content_snapshot.body).toBe("the post");
  });

  it("stores a null snapshot rather than a placeholder when the target is already gone", async () => {
    // A real race: the target can be deleted between the reporter opening the
    // page and submitting. Inventing a snapshot here would put fabricated
    // content in front of a moderator, which is the one thing this product
    // never does.
    double = createSupabaseDouble({
      posts: { data: null, error: null },
      reports: { data: null, error: null },
    });

    const result = await report();

    expect(result.error).toBeNull();
    const write = double.calls.find((call) => call.table === "reports");
    expect((write?.payload as { content_snapshot: unknown }).content_snapshot).toBeNull();
  });

  it("reads the comments table for a comment report, not posts", async () => {
    double = createSupabaseDouble({
      comments: { data: { body: "c", created_at: "t", post_id: "p", author: null }, error: null },
      reports: { data: null, error: null },
    });

    await report("spam", "comment", "comment-1");

    expect(double.calls.some((call) => call.table === "comments")).toBe(true);
    expect(double.calls.some((call) => call.table === "posts")).toBe(false);
  });

  it("reports a failed insert instead of telling the user it was submitted", async () => {
    double = createSupabaseDouble({
      posts: { data: { body: "b", created_at: "t", fixture_id: null, author: null }, error: null },
      reports: { data: null, error: { message: "constraint violation" } },
    });

    const result = await report();

    expect(result.error).toMatch(/couldn't submit/i);
  });
});
