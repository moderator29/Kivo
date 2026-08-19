import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * `/transfers?team={id}` — the endpoint that makes transfer history affordable.
 *
 * The thing under test is not "does it parse JSON". It is the two properties
 * the sync depends on and would not notice losing:
 *
 *  1. **The composite provider id is byte-identical to the one
 *     `getPlayerTransfers` builds for the same move.** All of deduplication
 *     rests on that: the same transfer fetched by club and later by player must
 *     resolve to one `provider_mappings` row, or KIVO stores the move twice and
 *     notifies every follower a second time.
 *  2. **An unnamed player yields no transfer at all.** A transfer row KIVO
 *     cannot attribute to a named player is a blank line on somebody's profile,
 *     not information.
 *
 * Mocked at `requestWithRetry`, like api-football-catalogue.test.ts: retry,
 * classification and quota headers are covered by api-football-request.test.ts,
 * and what matters here is only the mapping.
 */

vi.mock("server-only", () => ({}));

const requestWithRetry = vi.fn();

vi.mock("./api-football-request", async () => {
  const actual = await vi.importActual<typeof import("./api-football-request")>("./api-football-request");
  return { ...actual, requestWithRetry: (...args: unknown[]) => requestWithRetry(...args) };
});

function respondWith(body: unknown) {
  requestWithRetry.mockResolvedValue({
    response: { ok: true, status: 200, json: async () => body } as unknown as Response,
    quotaRemaining: 42,
  });
}

async function makeProvider() {
  const { ApiFootballProvider } = await import("./api-football");
  return new ApiFootballProvider("test-key");
}

const ONE_MOVE = {
  response: [
    {
      player: { id: 874, name: "Cristiano Ronaldo" },
      update: null,
      transfers: [
        {
          date: "2021-08-31",
          type: "€ 15M",
          teams: {
            out: { id: 489, name: "Juventus", logo: "juve.png" },
            in: { id: 33, name: "Manchester United", logo: "mufc.png" },
          },
        },
      ],
    },
  ],
};

beforeEach(() => {
  requestWithRetry.mockReset();
});

describe("getTeamTransfers", () => {
  it("maps a club's history, one row per move, with the player named", async () => {
    respondWith(ONE_MOVE);
    const transfers = await (await makeProvider()).getTeamTransfers("33");

    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      playerProviderId: "874",
      playerName: "Cristiano Ronaldo",
      fromTeamProviderId: "489",
      fromTeamName: "Juventus",
      toTeamProviderId: "33",
      toTeamName: "Manchester United",
      transferDate: "2021-08-31",
      feeText: "€ 15M",
      transferType: "transfer",
    });
  });

  it("asks the team endpoint, not the player one", async () => {
    respondWith({ response: [] });
    await (await makeProvider()).getTeamTransfers("33");
    expect(JSON.stringify(requestWithRetry.mock.calls[0])).toContain("/transfers?team=33");
  });

  it("builds the same provider id as getPlayerTransfers for the same move", async () => {
    // The whole deduplication story. If these two ever diverge, a club sync and
    // a player sync each insert their own copy of one transfer, and every
    // follower is notified twice about a move that happened once.
    respondWith(ONE_MOVE);
    const byTeam = await (await makeProvider()).getTeamTransfers("33");

    respondWith(ONE_MOVE);
    const byPlayer = await (await makeProvider()).getPlayerTransfers("874");

    expect(byTeam[0].providerId).toBe(byPlayer[0].providerId);
  });

  it("drops an entry whose player has no usable name rather than inventing one", async () => {
    respondWith({
      response: [
        { player: { id: 1, name: "   " }, update: null, transfers: [{ date: "2024-01-01", type: null, teams: { out: null, in: null } }] },
        { player: { id: null, name: "Nameless Id" }, update: null, transfers: [{ date: "2024-01-01", type: null, teams: { out: null, in: null } }] },
      ],
    });
    expect(await (await makeProvider()).getTeamTransfers("33")).toEqual([]);
  });

  it("flattens every move of every player, not just the first of each", async () => {
    respondWith({
      response: [
        {
          player: { id: 1, name: "Player One" },
          update: null,
          transfers: [
            { date: "2022-07-01", type: "Loan", teams: { out: { id: 33, name: "A", logo: null }, in: { id: 40, name: "B", logo: null } } },
            { date: "2023-07-01", type: "N/A", teams: { out: { id: 40, name: "B", logo: null }, in: { id: 33, name: "A", logo: null } } },
          ],
        },
        {
          player: { id: 2, name: "Player Two" },
          update: null,
          transfers: [
            { date: "2024-01-15", type: "Free", teams: { out: { id: 33, name: "A", logo: null }, in: { id: 50, name: "C", logo: null } } },
          ],
        },
      ],
    });

    const transfers = await (await makeProvider()).getTeamTransfers("33");
    expect(transfers).toHaveLength(3);
    expect(transfers.map((t) => t.transferType)).toEqual(["loan", "unknown", "free"]);
  });

  it("keeps a one-sided move rather than dropping it", async () => {
    // A club KIVO has never heard of is a null side, not a reason to lose the
    // move — the same rule NormalizedTransfer already documents, and the reason
    // reconcileUnresolvedTransferTeams exists.
    respondWith({
      response: [
        {
          player: { id: 7, name: "Retiring Player" },
          update: null,
          transfers: [{ date: "2025-06-30", type: null, teams: { out: { id: 33, name: "A", logo: null }, in: null } }],
        },
      ],
    });

    const transfers = await (await makeProvider()).getTeamTransfers("33");
    expect(transfers).toHaveLength(1);
    expect(transfers[0].toTeamProviderId).toBeNull();
    expect(transfers[0].fromTeamProviderId).toBe("33");
  });
});
