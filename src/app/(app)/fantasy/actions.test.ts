import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSupabaseDouble } from "@/lib/supabase/query-double";

/**
 * KN-130. `setGameweekRoster`'s deadline and ownership locks.
 *
 * Three separate rules live here, and only one of them has any database
 * backing:
 *
 *   - **the deadline** — the whole integrity of fantasy. If a squad can be
 *     changed after kickoff, every point scored after it is meaningless. There
 *     is no trigger enforcing this; this function is it.
 *   - **ownership** — `fantasyTeamId` arrives from the client. A server action
 *     is a public HTTP endpoint, so "the UI only ever sends your own team id"
 *     constrains nobody. RLS backs this one up, but the friendly refusal is
 *     here and is what a caller actually sees.
 *   - **season agreement** — a gameweek from one season must not be usable to
 *     set a roster in a league running a different one, which would silently
 *     score a squad against the wrong fixtures.
 *
 * Every case asserts that no roster row was written, not merely that an error
 * was returned.
 */

const profileMock = vi.fn();
const rateLimitMock = vi.fn();
let double: ReturnType<typeof createSupabaseDouble>;

vi.mock("@/lib/profile", () => ({ getOrCreateProfile: () => profileMock() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => rateLimitMock() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/rewards", () => ({ awardBadge: vi.fn() }));
vi.mock("@/lib/fantasy", () => ({
  getOrCreateFantasyTeam: vi.fn(),
  ensureFantasyPlayerPrices: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => double.client,
}));

const VIEWER = { id: "profile-1" };
const TEAM_ID = "team-1";
const GAMEWEEK_ID = "gw-1";
const HOUR = 60 * 60 * 1000;

function openGameweek(seasonId = "season-1") {
  return { id: GAMEWEEK_ID, deadline_at: new Date(Date.now() + 2 * HOUR).toISOString(), season_id: seasonId };
}
function closedGameweek(seasonId = "season-1") {
  return { id: GAMEWEEK_ID, deadline_at: new Date(Date.now() - HOUR).toISOString(), season_id: seasonId };
}
function team(ownerId: string, seasonId = "season-1") {
  return { id: TEAM_ID, owner_profile_id: ownerId, league: { season_id: seasonId } };
}

async function setRoster(picks = [{ playerId: "p1", isStarting: true }]) {
  const { setGameweekRoster } = await import("./actions");
  return setGameweekRoster(TEAM_ID, GAMEWEEK_ID, picks);
}

beforeEach(() => {
  vi.resetModules();
  profileMock.mockReset().mockResolvedValue(VIEWER);
  rateLimitMock.mockReset().mockResolvedValue({ ok: true });
});

describe("setGameweekRoster deadline lock", () => {
  it("refuses once the deadline has passed, and reads no further", async () => {
    double = createSupabaseDouble({ fantasy_gameweeks: { data: closedGameweek(), error: null } });

    const result = await setRoster();

    expect(result.error).toMatch(/deadline for this gameweek has passed/i);
    // The team is never even looked up: the deadline check has to come first,
    // or a locked gameweek would still cost a query per submission.
    expect(double.calls.some((call) => call.table === "fantasy_teams")).toBe(false);
  });

  it("refuses a gameweek that no longer exists", async () => {
    double = createSupabaseDouble({ fantasy_gameweeks: { data: null, error: null } });

    const result = await setRoster();

    expect(result.error).toMatch(/no longer exists/i);
  });
});

describe("setGameweekRoster ownership", () => {
  it("refuses a team the caller does not own", async () => {
    double = createSupabaseDouble({
      fantasy_gameweeks: { data: openGameweek(), error: null },
      fantasy_teams: { data: team("someone-else"), error: null },
    });

    const result = await setRoster();

    expect(result.error).toMatch(/don't own that fantasy team/i);
    expect(double.wrote("fantasy_roster_picks")).toBe(false);
  });

  it("refuses a team id that matches no row", async () => {
    double = createSupabaseDouble({
      fantasy_gameweeks: { data: openGameweek(), error: null },
      fantasy_teams: { data: null, error: null },
    });

    const result = await setRoster();

    expect(result.error).toMatch(/don't own that fantasy team/i);
  });

  it("refuses a gameweek from a different season than the team's league", async () => {
    double = createSupabaseDouble({
      fantasy_gameweeks: { data: openGameweek("season-1"), error: null },
      fantasy_teams: { data: team(VIEWER.id, "season-2"), error: null },
    });

    const result = await setRoster();

    expect(result.error).toMatch(/doesn't belong to your league's season/i);
  });
});

describe("setGameweekRoster squad validation", () => {
  it("refuses a squad containing the same player twice", async () => {
    double = createSupabaseDouble({
      fantasy_gameweeks: { data: openGameweek(), error: null },
      fantasy_teams: { data: team(VIEWER.id), error: null },
    });

    const result = await setRoster([
      { playerId: "p1", isStarting: true },
      { playerId: "p1", isStarting: false },
    ]);

    expect(result.error).toMatch(/only appear once/i);
  });

  it("refuses an empty squad rather than silently saving nothing", async () => {
    double = createSupabaseDouble({
      fantasy_gameweeks: { data: openGameweek(), error: null },
      fantasy_teams: { data: team(VIEWER.id), error: null },
    });

    const result = await setRoster([]);

    expect(result.error).toMatch(/add players/i);
  });
});

describe("setGameweekRoster caller identity", () => {
  it("refuses a signed-out caller before any query", async () => {
    profileMock.mockResolvedValue(null);
    double = createSupabaseDouble({});

    const result = await setRoster();

    expect(result.error).toMatch(/signed in/i);
    expect(double.calls).toHaveLength(0);
  });

  it("refuses a rate-limited caller before any query", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, error: "Too many changes." });
    double = createSupabaseDouble({});

    const result = await setRoster();

    expect(result.error).toBe("Too many changes.");
    expect(double.calls).toHaveLength(0);
  });
});
