import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Precedence, and the one failure mode that matters.
 *
 * An empty `competition_scope` table means "this feature is not in use" and
 * must fall through to the environment variable and then the shipped default.
 * If it ever meant "cover nothing", every sync would scope to zero fixtures and
 * the product would tell a fan there is no football today — which this codebase
 * has already said once, for a different reason, and must never say again by
 * accident.
 *
 * A failed read has the same requirement for the same reason.
 */

vi.mock("server-only", () => ({}));

function clientReturning(result: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve(result),
  };
  return { from: () => builder } as never;
}

const ORIGINAL_ENV = process.env.FOOTBALL_SYNC_COMPETITION_IDS;

beforeEach(() => {
  vi.resetModules();
  delete process.env.FOOTBALL_SYNC_COMPETITION_IDS;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.FOOTBALL_SYNC_COMPETITION_IDS;
  else process.env.FOOTBALL_SYNC_COMPETITION_IDS = ORIGINAL_ENV;
});

async function load() {
  return import("./competition-scope");
}

describe("resolveCompetitionScope", () => {
  it("uses the operator's rows, in the operator's order", async () => {
    const { resolveCompetitionScope } = await load();
    const scope = await resolveCompetitionScope(
      clientReturning({
        data: [
          { provider_entity_id: "307", label: "Pro League", country: "Saudi-Arabia", position: 0 },
          { provider_entity_id: "39", label: "Premier League", country: "England", position: 1 },
        ],
        error: null,
      }),
      "api-football",
    );

    expect(scope.source).toBe("database");
    expect(scope.orderedIds).toEqual(["307", "39"]);
    // Nothing in the code ranks one competition above another. An operator who
    // puts Saudi first gets Saudi first.
    expect(scope.entries[0]).toMatchObject({ providerId: "307", label: "Pro League" });
  });

  it("falls through to the shipped default when the table is empty", async () => {
    const { resolveCompetitionScope } = await load();
    const scope = await resolveCompetitionScope(clientReturning({ data: [], error: null }), "api-football");

    expect(scope.source).toBe("default");
    // Emphatically NOT an empty allowlist.
    expect(scope.orderedIds.length).toBeGreaterThan(0);
    expect(scope.providerIds?.size).toBeGreaterThan(0);
  });

  it("falls through to the environment variable when the table is empty", async () => {
    process.env.FOOTBALL_SYNC_COMPETITION_IDS = "253,307";
    const { resolveCompetitionScope } = await load();
    const scope = await resolveCompetitionScope(clientReturning({ data: [], error: null }), "api-football");

    expect(scope.source).toBe("env");
    expect(scope.orderedIds).toEqual(["253", "307"]);
  });

  it("does not blank the scope when the read fails", async () => {
    // A transient database error must not silently change what the pipeline
    // syncs. The static answer is a worse answer, never a wrong one.
    const { resolveCompetitionScope } = await load();
    const scope = await resolveCompetitionScope(
      clientReturning({ data: null, error: { message: "connection reset" } }),
      "api-football",
    );

    expect(scope.source).toBe("default");
    expect(scope.orderedIds.length).toBeGreaterThan(0);
  });

  it("keeps 'no filter at all' reachable", async () => {
    process.env.FOOTBALL_SYNC_COMPETITION_IDS = "all";
    const { resolveCompetitionScope } = await load();
    const scope = await resolveCompetitionScope(clientReturning({ data: [], error: null }), "api-football");

    expect(scope.source).toBe("unfiltered");
    // Null means no filter — a real answer, distinct from an empty set.
    expect(scope.providerIds).toBeNull();
  });

  it("returns a real membership set the fixture sync can filter with", async () => {
    const { resolveSyncedCompetitionProviderIds } = await load();
    const ids = await resolveSyncedCompetitionProviderIds(
      clientReturning({
        data: [{ provider_entity_id: "253", label: "Major League Soccer", country: "USA", position: 0 }],
        error: null,
      }),
      "api-football",
    );

    expect(ids?.has("253")).toBe(true);
    expect(ids?.has("39")).toBe(false);
  });
});
