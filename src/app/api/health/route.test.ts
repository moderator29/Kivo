import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * KN-135. `/api/health` is the one endpoint whose *response shape* is a
 * contract with something outside this repo: an uptime monitor is configured
 * once, against a status code and a JSON body, and then nobody looks at it
 * again until it fires. A monitor that silently stops understanding the body is
 * worse than no monitor, because it keeps reporting success.
 *
 * So the shape is tested, not just the happy path — specifically the two things
 * a monitor is configured against: the status code, and the `status` /
 * `checks.database` fields it is told to read (see ENVIRONMENT.md).
 *
 * The Supabase client is mocked rather than reached: this asserts the
 * endpoint's contract, not Supabase's availability, and a test that needs a
 * network is a test that fails for reasons that are not bugs.
 */

const selectMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleSupabaseClient: () => ({
    from: () => ({ select: () => ({ limit: selectMock }) }),
  }),
}));

// Silence the structured error log for the deliberate failure cases; the sink
// itself is exercised by lib/log's own callers, not by this contract test.
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

async function callHealth() {
  const { GET } = await import("./route");
  const response = await GET();
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.resetModules();
  selectMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/health", () => {
  it("answers 200 with the documented healthy shape when the database responds", async () => {
    selectMock.mockResolvedValue({ data: [{ id: "x" }], error: null });

    const { response, body } = await callHealth();

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.checks.database).toBe("ok");
    // A monitor may key an alert off staleness, so the timestamp has to parse.
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("answers 503 with the documented unhealthy shape when the query errors", async () => {
    selectMock.mockResolvedValue({ data: null, error: { message: "connection refused" } });

    const { response, body } = await callHealth();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.checks.database).toBe("unreachable");
  });

  it("answers 503 rather than throwing when the client cannot even be built", async () => {
    // The real failure mode this guards: createServiceRoleSupabaseClient()
    // throws synchronously when SUPABASE_SERVICE_ROLE_KEY is absent. An
    // endpoint whose entire job is to report an outage must never become one —
    // an unhandled throw returns a 500 with a stack trace, and a monitor
    // parsing the documented body would report "500" instead of "database
    // unreachable".
    selectMock.mockImplementation(() => {
      throw new Error("supabaseKey is required.");
    });

    const { response, body } = await callHealth();

    expect(response.status).toBe(503);
    expect(body.status).toBe("unhealthy");
    expect(body.checks.database).toBe("unreachable");
  });
});
