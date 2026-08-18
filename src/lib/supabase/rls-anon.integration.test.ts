import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "./types";

// =============================================================================
// RLS integration test — real anon-key traffic against the live/connected
// Supabase project (RECOMMENDATIONS.md #208).
// =============================================================================
//
// WHAT THIS COVERS (and, honestly, what it doesn't)
// ---------------------------------------------------
// This file makes real HTTP requests through @supabase/supabase-js with the
// project's real publishable anon key — nothing here is mocked, and every
// assertion reflects genuine Postgres RLS policy evaluation on the other end
// (see supabase/migrations/0001_kivo_core_schema.sql). What it can prove:
//
//   - A logged-out (anon-role) client really can read public-read tables
//     (`teams`, `badges` — seeded reference data already in the project).
//   - An anon-role client really gets zero rows back (not an error — RLS
//     silently filters, which is a materially different, easy-to-miss
//     failure mode) from owner-scoped tables (`predictions`, `notifications`,
//     `profiles`, `fantasy_teams`), even though it has table-level grants.
//   - An anon-role client's INSERT into an owner-scoped table is rejected by
//     RLS outright (42501), not merely "not returned later".
//
// What it CANNOT prove: cross-user isolation between two distinct
// *authenticated* identities. RLS reads the caller's identity from a signed
// Supabase Auth JWT — `auth.uid()`, resolved to a profile by
// private.current_profile_id() (see migration 0053). Minting one for a
// synthetic user means completing a real email-OTP round trip, including
// reading the code out of an inbox, which a headless test run cannot do. So
// this file cannot authenticate as "Alice" or "Bob" and therefore cannot
// exercise `predictions_select_own` / `fantasy_rosters_all_own` /
// `notifications_select_own` etc. the way a real user's browser would.
//
// scripts/verify-rls.sql covers exactly that gap: it exercises the identical
// Postgres-side mechanism (`set local role authenticated; set local
// request.jwt.claims = '{"sub": "<auth.users.id>", ...}'`) that PostgREST
// itself uses after verifying a JWT, against two synthetic profiles, and is
// the primary/more complete half of this task's RLS coverage. Read that
// file's header comment for the full rationale. This file is the
// complementary, standard, CI-friendly half — real anon-key network traffic
// for what's actually reachable that way.
//
// WHY THIS SKIPS ITSELF SO OFTEN
// -------------------------------
// This suite needs real network access to the live project and a real anon
// key, and neither is guaranteed to be available wherever `npm test` runs:
//   - CI's "Test" step (.github/workflows/ci.yml) intentionally does not
//     inject NEXT_PUBLIC_SUPABASE_URL/ANON_KEY (only the later build step
//     gets placeholder values), so this suite has no credentials there.
//   - A local .env.local, if present, IS picked up below without requiring
//     the `dotenv` package (not a project dependency) — but even with real
//     credentials, some sandboxes block outbound HTTPS to *.supabase.co at
//     the network/proxy layer (confirmed true of the sandbox this file was
//     authored in). Notably, that proxy doesn't fail the TCP/TLS handshake —
//     it answers with a normal-looking HTTP response carrying a JSON body
//     like `{"message":"Host not in allowlist..."}`, which is easy to
//     mistake for a real (if erroring) PostgREST response if you only check
//     "did fetch throw" or "was the status < 500". The reachability probe
//     below instead requires an actual clean, error-free query result — any
//     error at all, thrown or returned, is treated as "can't verify",
//     because a poisoned host-blocked response and a real RLS-driven error
//     are otherwise indistinguishable from here.
// This makes the file safe to commit and run everywhere: it exercises real
// RLS wherever it can reach the project, and quietly no-ops everywhere else
// rather than turning "network unavailable" into a false red build.
// =============================================================================

function loadDotEnvLocalIfPresent() {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2].trim();
    }
  }
}
loadDotEnvLocalIfPresent();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function isReachable(url: string, key: string): Promise<boolean> {
  try {
    const probe = createClient<Database>(url, key, { auth: { persistSession: false } });
    const { error } = await probe
      .from("teams")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(4000));
    // A genuinely reachable PostgREST endpoint returns no error here (the
    // query is trivially valid and `teams` is public-read). ANY error —
    // thrown, timed out, or returned as `error` — means we can't trust
    // what's on the other end (see the file header for why a network-level
    // block can masquerade as a normal-looking response), so treat it as
    // "not reachable" and skip rather than risk a false pass/fail.
    return error === null;
  } catch {
    return false;
  }
}

const reachable =
  !!supabaseUrl && !!anonKey ? await isReachable(supabaseUrl, anonKey) : false;

if (!reachable) {
  console.warn(
    "[rls-anon.integration.test] Skipping: live Supabase project not reachable " +
      "(missing NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, or the network path to " +
      "*.supabase.co is blocked in this environment). See file header for why " +
      "this is a skip, not a failure. Run scripts/verify-rls.sql for the " +
      "primary, always-runnable RLS check.",
  );
}

describe.skipIf(!reachable)("RLS via anon key (live PostgREST, no mocking)", () => {
  let anon: ReturnType<typeof createClient<Database>>;

  beforeAll(() => {
    anon = createClient<Database>(supabaseUrl!, anonKey!, {
      auth: { persistSession: false },
    });
  });

  describe("public-read tables — anon really can read them", () => {
    it("reads rows from `teams` (public reference data) with no error", async () => {
      const { data, error } = await anon.from("teams").select("id, name").limit(5);
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("reads rows from `badges` (public reference data, seeded by migration 0004) with no error", async () => {
      const { data, error } = await anon.from("badges").select("id, code").limit(5);
      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
      // badges is seeded by 0004_seed_starter_badges.sql — if this is ever
      // empty, either that seed regressed or badges_select_public broke.
      expect(data!.length).toBeGreaterThan(0);
    });
  });

  describe("owner-scoped tables — anon is silently filtered to zero rows, not errored", () => {
    it("gets an empty array (not an error) reading `predictions`", async () => {
      const { data, error } = await anon.from("predictions").select("id").limit(5);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("gets an empty array (not an error) reading `notifications`", async () => {
      const { data, error } = await anon.from("notifications").select("id").limit(5);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("gets an empty array (not an error) reading `profiles`", async () => {
      const { data, error } = await anon.from("profiles").select("id").limit(5);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("gets an empty array (not an error) reading `fantasy_teams`", async () => {
      const { data, error } = await anon.from("fantasy_teams").select("id").limit(5);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });

  describe("owner-scoped tables — anon writes are rejected by RLS, not merely invisible later", () => {
    it("is rejected (RLS 42501) inserting into `notifications`", async () => {
      const { error } = await anon
        .from("notifications")
        .insert({ profile_id: "00000000-0000-0000-0000-000000000000", type: "zzrlstest_forged" });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });

    it("is rejected (RLS 42501) inserting into `predictions`", async () => {
      const { error } = await anon.from("predictions").insert({
        profile_id: "00000000-0000-0000-0000-000000000000",
        fixture_id: "00000000-0000-0000-0000-000000000000",
        predicted_outcome: "draw",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("42501");
    });
  });
});
