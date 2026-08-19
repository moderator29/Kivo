import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { pruneSupersededUploads } from "@/lib/storage-uploads";

/**
 * The sweep that gives "never delete a superseded upload" a ceiling.
 *
 * Two properties matter and both are one-way: deleting the live object breaks
 * every page showing that user's avatar, and a sweep that throws would turn a
 * completed upload into a reported failure. Everything else here is cost.
 */

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const USER = "auth-user-1";

type Listed = { name: string };

function storageDouble(objects: Listed[] | null, opts: { listError?: unknown; removeError?: unknown } = {}) {
  const removed: string[][] = [];
  const client = {
    storage: {
      from: () => ({
        list: async () => ({ data: objects, error: opts.listError ?? null }),
        remove: async (paths: string[]) => {
          removed.push(paths);
          return { data: null, error: opts.removeError ?? null };
        },
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { client, removed };
}

beforeEach(() => vi.clearAllMocks());

describe("pruneSupersededUploads", () => {
  it("keeps the live object and one predecessor, and deletes the rest", async () => {
    // Listed newest-first, which is what the action asks for.
    const { client, removed } = storageDouble([
      { name: "500.png" },
      { name: "400.png" },
      { name: "300.png" },
      { name: "200.png" },
    ]);

    await pruneSupersededUploads(client, "avatars", USER, `${USER}/500.png`);

    expect(removed).toEqual([[`${USER}/300.png`, `${USER}/200.png`]]);
  });

  it("never deletes the object just uploaded, even if the listing disagrees about order", async () => {
    // A clock skew or an out-of-order listing must not be able to delete the
    // file the profile row now points at — that would break every page
    // rendering this user's avatar, and the upload would have reported success.
    const { client, removed } = storageDouble([
      { name: "900.png" },
      { name: "800.png" },
      { name: "700.png" },
    ]);

    await pruneSupersededUploads(client, "avatars", USER, `${USER}/700.png`);

    expect(removed).toEqual([]);
  });

  it("does nothing when there is nothing superseded yet", async () => {
    const { client, removed } = storageDouble([{ name: "200.png" }, { name: "100.png" }]);

    await pruneSupersededUploads(client, "backgrounds", USER, `${USER}/200.png`);

    expect(removed).toEqual([]);
  });

  it("does nothing on an empty folder", async () => {
    const { client, removed } = storageDouble([]);

    await pruneSupersededUploads(client, "avatars", USER, `${USER}/1.png`);

    expect(removed).toEqual([]);
  });

  it("stays silent when the listing fails rather than guessing what to delete", async () => {
    const { client, removed } = storageDouble(null, { listError: { message: "nope" } });

    await expect(pruneSupersededUploads(client, "avatars", USER, `${USER}/1.png`)).resolves.toBeUndefined();
    expect(removed).toEqual([]);
  });

  it("swallows a failed delete — the upload it follows has already succeeded", async () => {
    const { client } = storageDouble(
      [{ name: "3.png" }, { name: "2.png" }, { name: "1.png" }],
      { removeError: { message: "denied" } },
    );

    await expect(pruneSupersededUploads(client, "avatars", USER, `${USER}/3.png`)).resolves.toBeUndefined();
  });

  it("swallows a thrown storage call", async () => {
    const client = {
      storage: {
        from: () => ({
          list: async () => {
            throw new Error("network");
          },
        }),
      },
    } as unknown as SupabaseClient<Database>;

    await expect(pruneSupersededUploads(client, "avatars", USER, `${USER}/1.png`)).resolves.toBeUndefined();
  });
});
