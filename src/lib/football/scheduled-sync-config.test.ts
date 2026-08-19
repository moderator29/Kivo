import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Deployment-configuration failures on the scheduled sync route, tested for
 * the one property that matters: **the response says which thing is missing.**
 *
 * This route is the only thing standing between a fresh deployment and an
 * empty database, and it is called by a scheduler nobody watches. When it
 * fails, the founder does not see a stack trace — they see football surfaces
 * that stay empty, and Admin → Data Health reporting "Never run".
 *
 * "Never run" is true for at least four unrelated reasons: CRON_SECRET is
 * unset, the bearer token is wrong, SUPABASE_SERVICE_ROLE_KEY is unset, or
 * the cron was never deployed at all. Three of those are answerable by this
 * route, and it must answer them differently — otherwise the diagnosis is a
 * guess. Before the SUPABASE_SERVICE_ROLE_KEY guard these tests pin, that case
 * returned a bare 500 with no body, which is the one outcome that tells the
 * reader nothing.
 *
 * Everything below the configuration checks is mocked away deliberately: this
 * asserts the route's deployment contract, not the sync itself.
 */

/**
 * A longer timeout than the 5s default, and the reason is structural rather
 * than "this machine is slow".
 *
 * Every test here calls `vi.resetModules()` and then dynamically re-imports
 * `./scheduled-sync`, because the thing under test is how the route reads
 * environment variables AT MODULE LOAD — and there is no way to re-read those
 * without rebuilding the module graph. So each of the five tests pays for a
 * fresh transform of the route and everything it imports.
 *
 * That costs ~1.5s on an idle machine and comfortably over 5s on a loaded one.
 * It failed exactly that way during a merge run while several builds were
 * running on the same box: 5011ms against a 5000ms limit.
 *
 * Raising the limit rather than trimming the work is deliberate. The
 * re-import IS the test — mocking it away would leave these five assertions
 * checking a module that had already captured the wrong environment. A test
 * that only passes on an idle machine is a green build that isn't, and CI
 * runners are never idle.
 */
vi.setConfig({ testTimeout: 30_000 });

const createServiceRoleSupabaseClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleSupabaseClient: () => createServiceRoleSupabaseClientMock(),
  createServerSupabaseClient: () => ({}),
}));

vi.mock("@/lib/log", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

const ORIGINAL_ENV = { ...process.env };

async function call(headers: Record<string, string> = {}) {
  const { handleScheduledSync } = await import("./scheduled-sync");
  const request = new Request("https://kivo.test/api/cron/sync-daily", { headers });
  const response = await handleScheduledSync(request, "daily");
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.resetModules();
  createServiceRoleSupabaseClientMock.mockReset();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("scheduled sync deployment configuration", () => {
  it("names CRON_SECRET when it is not set at all", async () => {
    delete process.env.CRON_SECRET;

    const { response, body } = await call({ authorization: "Bearer anything" });

    // 500, not 401: nobody can authenticate against a secret that does not
    // exist, so this is a deployment problem rather than a rejected caller.
    expect(response.status).toBe(500);
    expect(body.error).toMatch(/CRON_SECRET/);
    expect(createServiceRoleSupabaseClientMock).not.toHaveBeenCalled();
  });

  it("returns a plain 401 for a wrong token once CRON_SECRET is configured", async () => {
    process.env.CRON_SECRET = "the-real-secret";

    const { response, body } = await call({ authorization: "Bearer not-the-real-secret" });

    expect(response.status).toBe(401);
    // Deliberately does NOT name the secret: an unauthenticated caller learns
    // nothing about this deployment's configuration.
    expect(body.error).toBe("Unauthorized");
  });

  it("returns a plain 401 when no authorization header is sent at all", async () => {
    process.env.CRON_SECRET = "the-real-secret";

    const { response, body } = await call();

    expect(response.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("names SUPABASE_SERVICE_ROLE_KEY when an authorized call cannot build a client", async () => {
    process.env.CRON_SECRET = "the-real-secret";
    // Exactly what supabase-js does with an undefined key.
    createServiceRoleSupabaseClientMock.mockImplementation(() => {
      throw new Error("supabaseKey is required.");
    });

    const { response, body } = await call({ authorization: "Bearer the-real-secret" });

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("gives the two deployment failures distinguishable messages", async () => {
    delete process.env.CRON_SECRET;
    const missingSecret = (await call({ authorization: "Bearer x" })).body.error;

    vi.resetModules();
    process.env.CRON_SECRET = "the-real-secret";
    createServiceRoleSupabaseClientMock.mockImplementation(() => {
      throw new Error("supabaseKey is required.");
    });
    const missingKey = (await call({ authorization: "Bearer the-real-secret" })).body.error;

    // The whole point: a reader can tell which env var to go and set.
    expect(missingSecret).not.toBe(missingKey);
  });
});
