import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { matchRoomWindow } from "@/lib/match-room-window";
import { isLiveStatus, type FixtureStatus } from "@/lib/football/fixture-status";
import { logError } from "@/lib/log";

/**
 * The matches a fan can pin a post to.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `posts.fixture_id` has meant "this post is about that match" since migration
 * 0001, and both `createPost` and `createPoll` have always read a `fixture_id`
 * field off the form. Until now the only UI that ever set it was the composer
 * inside a Match Room — so the general composer at `/social/compose` could
 * write about a match but never say which one, and `PostEntityCard` (which
 * already renders the match a post carries) had nothing to draw for anything
 * written outside a Room.
 *
 * That is the difference between a football product and a timeline that
 * happens to be about football: a take belongs to a fixture, and the fixture
 * should travel with it into every feed it appears in.
 *
 * WHAT IS OFFERED, AND WHY IT IS NOT "EVERY FIXTURE"
 * ---------------------------------------------------------------------------
 * Only matches whose Room genuinely accepts posts. Migration 0110 adds a
 * RESTRICTIVE policy that refuses an insert carrying a `fixture_id` whose
 * window has closed — so offering a fixture from last season would be offering
 * a fan the chance to type a paragraph into a box that throws it away. The
 * same `matchRoomWindow()` the Room's own UI uses decides what appears here,
 * so the picker and the database agree by construction rather than by
 * coincidence.
 *
 * The window opens when the fixture exists, which in practice is the whole
 * synced season ahead. A picker holding a season of fixtures is not a picker,
 * so this asks for a horizon around now and lets the fan search inside it.
 * Nothing is ranked, weighted or scored — the ordering is kickoff time and the
 * grouping is "is this live", "is this your club", "is this soon", all of which
 * are facts.
 */

/** How far ahead the picker looks. Long enough to hold the next round of
 * fixtures for every competition KIVO syncs, short enough that the list is
 * still a list. */
const HORIZON_DAYS = 10;

/**
 * How far back. The Room stays open 24h after the expected final whistle
 * (kickoff + 2h), so 26 hours is the exact age of the oldest fixture that can
 * still accept a post. Asking for more would only fetch rows `matchRoomWindow`
 * is about to reject.
 */
const LOOKBACK_HOURS = 26;

/** A hard ceiling on the round trip. The client filters inside this. */
const MAX_ROWS = 120;

export type AttachableMatch = {
  id: string;
  kickoffAt: string;
  status: FixtureStatus;
  homeScore: number | null;
  awayScore: number | null;
  homeName: string;
  homeShortName: string | null;
  homeCrestUrl: string | null;
  awayName: string;
  awayShortName: string | null;
  awayCrestUrl: string | null;
  competitionName: string | null;
  /** True when the match is in play right now. */
  live: boolean;
  /** True when either side is a club this fan supports or follows. Real rows
   * — `profiles.favourite_team_id` and their own `follows` — never a guess at
   * what they might care about. */
  yours: boolean;
};

type TeamRow = { name: string; short_name: string | null; crest_url: string | null };

/**
 * `failed` is kept distinct from an empty list for the reason every read in
 * this codebase keeps it distinct: "no matches to attach right now" and "KIVO
 * could not read the fixture list" are different sentences, and the composer
 * says the right one instead of implying football has stopped.
 */
export type AttachableMatchesResult = { failed: boolean; matches: AttachableMatch[] };

export async function fetchAttachableMatches(
  viewer: { id: string; favouriteTeamId: string | null } | null,
  now: Date = new Date(),
): Promise<AttachableMatchesResult> {
  const supabase = createServerSupabaseClient();

  const from = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [fixturesResult, followedTeamIds] = await Promise.all([
    supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id,
         home_team:teams!fixtures_home_team_id_fkey(name, short_name, crest_url),
         away_team:teams!fixtures_away_team_id_fkey(name, short_name, crest_url),
         competition:competitions(name, short_name)`,
      )
      .gte("kickoff_at", from)
      .lte("kickoff_at", to)
      .order("kickoff_at", { ascending: true })
      .limit(MAX_ROWS),
    fetchFollowedTeamIds(supabase, viewer?.id ?? null),
  ]);

  if (fixturesResult.error) {
    logError("social.compose.attachableMatches", fixturesResult.error);
    return { failed: true, matches: [] };
  }

  const mine = new Set(followedTeamIds);
  if (viewer?.favouriteTeamId) mine.add(viewer.favouriteTeamId);

  const matches: AttachableMatch[] = [];
  for (const row of fixturesResult.data ?? []) {
    // A fixture with one side missing is not a match, it is half a row — the
    // same rule `toPostFixture` applies in posts.ts. Half a card claiming to
    // be a fixture is worse than no card, and worse still as something to
    // attach a post to.
    const home: TeamRow | null = row.home_team;
    const away: TeamRow | null = row.away_team;
    if (!home || !away) continue;
    // The picker and migration 0110 must agree on what is postable. This is
    // that agreement, evaluated per row rather than approximated by the date
    // range above — an abandoned match closes 24h after its own kickoff
    // rather than 24h after a final whistle it never had.
    if (!matchRoomWindow(row.kickoff_at, row.status, now).open) continue;
    matches.push({
      id: row.id,
      kickoffAt: row.kickoff_at,
      status: row.status,
      homeScore: row.home_score,
      awayScore: row.away_score,
      homeName: home.name,
      homeShortName: home.short_name,
      homeCrestUrl: home.crest_url,
      awayName: away.name,
      awayShortName: away.short_name,
      awayCrestUrl: away.crest_url,
      competitionName: row.competition?.short_name ?? row.competition?.name ?? null,
      live: isLiveStatus(row.status),
      yours: mine.has(row.home_team_id) || mine.has(row.away_team_id),
    });
  }

  return { failed: false, matches };
}

/**
 * The clubs this fan follows. `follows_select_own` already scopes this to the
 * caller's own rows; the explicit filter is defence in depth and lets a
 * signed-out render skip the query entirely.
 *
 * A failure here is deliberately not an error: it costs the "Your clubs"
 * grouping and nothing else, and losing a grouping is not worth losing the
 * picker over.
 */
async function fetchFollowedTeamIds(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  profileId: string | null,
): Promise<string[]> {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from("follows")
    .select("followed_id")
    .eq("follower_profile_id", profileId)
    .eq("followed_type", "team");
  if (error) {
    logError("social.compose.followedTeams", error);
    return [];
  }
  return (data ?? []).map((row) => row.followed_id);
}

/**
 * One match by id, for the `?match=<id>` deep link — "post about this match"
 * from a fixture page lands on the composer with the match already attached,
 * which is the entry point that makes attaching feel like part of watching
 * football rather than a form field.
 *
 * Returns null for a fixture that does not exist or whose window has closed,
 * so a stale link degrades to an ordinary composer rather than to an error.
 */
export async function fetchAttachableMatch(
  fixtureId: string,
  now: Date = new Date(),
): Promise<AttachableMatch | null> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixtures")
    .select(
      `id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id,
       home_team:teams!fixtures_home_team_id_fkey(name, short_name, crest_url),
       away_team:teams!fixtures_away_team_id_fkey(name, short_name, crest_url),
       competition:competitions(name, short_name)`,
    )
    .eq("id", fixtureId)
    .maybeSingle();

  if (error) {
    logError("social.compose.attachableMatch", error, { fixtureId });
    return null;
  }
  if (!data?.home_team || !data.away_team) return null;
  if (!matchRoomWindow(data.kickoff_at, data.status, now).open) return null;

  return {
    id: data.id,
    kickoffAt: data.kickoff_at,
    status: data.status,
    homeScore: data.home_score,
    awayScore: data.away_score,
    homeName: data.home_team.name,
    homeShortName: data.home_team.short_name,
    homeCrestUrl: data.home_team.crest_url,
    awayName: data.away_team.name,
    awayShortName: data.away_team.short_name,
    awayCrestUrl: data.away_team.crest_url,
    competitionName: data.competition?.short_name ?? data.competition?.name ?? null,
    live: isLiveStatus(data.status),
    yours: false,
  };
}
