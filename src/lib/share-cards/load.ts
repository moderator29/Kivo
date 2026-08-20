import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { resolveAvatarSrc } from "@/lib/kivo-assets";
import { computePlayerMatchStats, PLAYED_STATUSES } from "@/lib/football/player-stats";
import { TRANSFER_TYPE_LABEL } from "@/lib/football/transfer-labels";
import { logError } from "@/lib/log";
import {
  buildAiInsightCard,
  buildFantasyPerformanceCard,
  buildLeagueTableCard,
  buildLiveScoreCard,
  buildPlayerComparisonCard,
  buildPlayerPerformanceCard,
  buildPredictionCard,
  buildProfileAchievementCard,
  buildTransferCard,
  type LiveScoreEventRow,
  type LiveScoreFixtureRow,
  type PlayerRow,
  type PlayerTotals,
  type StandingRow,
  type TransferRow,
} from "./build";
import type { ShareCardData, ShareCardKind } from "./types";

type Client = SupabaseClient<Database>;

/**
 * Loading a share card, once, for both the sheet and the image route.
 *
 * Every query here runs through the **viewer's own** Supabase client, so RLS
 * decides what a card may contain. That is deliberate and it is the security
 * model for the personal cards: a prediction card, a fantasy card and a
 * profile card are only renderable by someone the database already lets read
 * those rows. The image route does not re-check ownership in application
 * code, because doing it twice in two places is how the two get out of sync.
 *
 * Returning `null` is a normal, expected outcome — "there is nothing real to
 * put on a card here". Callers render no share affordance at all in that
 * case, which is the honest alternative to a card full of dashes.
 */

/** Provider slugs as they are stored, mapped to how they are written. Matches
 * `getActiveProviderStatus()`'s own labels in src/lib/football/index.ts. */
const PROVIDER_DISPLAY_NAME: Record<string, string> = {
  "api-football": "API-Football",
  thesportsdb: "TheSportsDB",
  mock: "KIVO sample data",
};

const FIXTURE_SELECT = `
  status, kickoff_at, home_score, away_score, minute_elapsed,
  competition:competitions(name),
  venue:venues(name, city),
  home_team:teams!fixtures_home_team_id_fkey(id, name, short_name, crest_url),
  away_team:teams!fixtures_away_team_id_fkey(id, name, short_name, crest_url)
`;

const PLAYER_SELECT = `
  full_name, photo_url, position,
  team:teams!players_current_team_id_fkey(name, short_name, crest_url)
`;

async function loadFixture(supabase: Client, fixtureId: string): Promise<LiveScoreFixtureRow | null> {
  const { data } = await supabase.from("fixtures").select(FIXTURE_SELECT).eq("id", fixtureId).maybeSingle();
  return (data as unknown as LiveScoreFixtureRow) ?? null;
}

/**
 * Real appearance/goal/card totals for one player, reusing the exact function
 * `/players/[id]` and the comparison page already compute theirs with — so a
 * card can never disagree with the page it was shared from.
 *
 * The nulls here are the load-bearing part. `appearances` is null when the
 * player has no synced lineup rows *at all* (nothing is known), and `0` when
 * they have rows but none against a played fixture (something is known and it
 * is zero). Same for goals against events.
 *
 * **Assists are now real** (2026-08-19). An earlier version of this comment
 * said KIVO had no assist data because `fixture_event_type` has no `assist`
 * member — that was wrong, and the correction matters: API-Football puts the
 * assister on the goal event itself, and `sync-match-details.ts` has always
 * mapped it to `fixture_events.related_player_id`. `fantasy-scoring.ts` has
 * been awarding points from it the whole time. It is counted here from the
 * same rows the goals come from, so a card's goals and assists always span the
 * same set of matches — see computePlayerMatchStats for why the per-match
 * statistics table is deliberately not the source.
 */
async function loadPlayerTotals(supabase: Client, playerId: string): Promise<PlayerTotals> {
  const [{ data: lineupRows }, { data: eventRows }, { data: assistEventRows }] = await Promise.all([
    supabase.from("lineups").select("is_starting, fixture:fixtures(status)").eq("player_id", playerId),
    supabase.from("fixture_events").select("event_type").eq("player_id", playerId),
    supabase.from("fixture_events").select("event_type").eq("related_player_id", playerId),
  ]);

  const lineups = (lineupRows ?? []) as unknown as { is_starting: boolean; fixture: { status: Database["public"]["Enums"]["fixture_status"] } | null }[];
  const events = (eventRows ?? []) as { event_type: Database["public"]["Enums"]["fixture_event_type"] }[];

  const hasLineupData = lineups.length > 0;
  const hasEventData = events.length > 0 || hasLineupData;

  const assistEvents = (assistEventRows ?? []) as { event_type: Database["public"]["Enums"]["fixture_event_type"] }[];
  const totals = computePlayerMatchStats(lineups, events, assistEvents);

  return {
    appearances: hasLineupData ? totals.appearances : null,
    starts: hasLineupData ? totals.starts : null,
    // A player with a played appearance and no goal events really did score
    // none; a player with nothing synced has no number.
    goals: hasEventData ? totals.goals : null,
    // Same gate as goals, and for the same reason: both are counted off
    // `fixture_events`, so "this player has appeared in matches KIVO synced"
    // is what makes a zero here meaningful rather than merely absent.
    assists: hasEventData ? totals.assists : null,
    yellowCards: hasEventData ? totals.yellowCards : null,
    redCards: hasEventData ? totals.redCards : null,
  };
}

/** What window the player numbers cover, said plainly. KIVO aggregates every
 * match it holds rather than filtering to a season, and the card says exactly
 * that instead of implying a season it never filtered on.
 *
 * FRONTEND SWEEP: "All matches synced to KIVO" — a share card is the one piece
 * of this product that leaves it, posted by a fan to people who have never
 * opened KIVO, and "synced" is the word they would have met first. */
const PLAYER_WINDOW_LABEL = "All matches KIVO has on record";

async function loadPlayer(supabase: Client, playerId: string): Promise<PlayerRow | null> {
  const { data } = await supabase.from("players").select(PLAYER_SELECT).eq("id", playerId).maybeSingle();
  return (data as unknown as PlayerRow) ?? null;
}

/* ------------------------------------------------------------------ */

async function loadLiveScore(supabase: Client, fixtureId: string): Promise<ShareCardData | null> {
  const fixture = await loadFixture(supabase, fixtureId);
  if (!fixture) return null;

  // `fixture_events` has no `player_name` column — the scorer is a real FK to
  // `players`, resolved here the same way getMatchShareCardData does it. This
  // was selecting a column that does not exist, which PostgREST answers with
  // an error rather than a row, so every score card rendered with an empty
  // scorers panel and no sign anything had failed. Found by rendering against
  // a seeded database; no unit test over a pure builder could have caught it.
  const { data: events } = await supabase
    .from("fixture_events")
    .select(
      `event_type, minute, added_time, team_id,
       player:players!fixture_events_player_id_fkey(full_name, known_as)`,
    )
    .eq("fixture_id", fixtureId)
    .in("event_type", ["goal", "penalty_goal", "own_goal"])
    .order("minute", { ascending: true });

  const scorerRows: LiveScoreEventRow[] = (
    (events ?? []) as unknown as {
      event_type: string;
      minute: number;
      added_time: number | null;
      team_id: string;
      player: { full_name: string; known_as: string | null } | null;
    }[]
  ).map((event) => ({
    event_type: event.event_type,
    minute: event.minute,
    added_time: event.added_time,
    team_id: event.team_id,
    // Known-as first: a card has room for "Hakim", not for a full legal name.
    player_name: event.player?.known_as ?? event.player?.full_name ?? null,
  }));

  return buildLiveScoreCard(fixture, scorerRows);
}

async function loadPlayerPerformance(supabase: Client, playerId: string): Promise<ShareCardData | null> {
  const [player, totals] = await Promise.all([loadPlayer(supabase, playerId), loadPlayerTotals(supabase, playerId)]);
  if (!player) return null;
  return buildPlayerPerformanceCard(player, totals, PLAYER_WINDOW_LABEL);
}

async function loadPlayerComparison(
  supabase: Client,
  leftId: string,
  rightId: string,
): Promise<ShareCardData | null> {
  const [leftPlayer, rightPlayer, leftTotals, rightTotals] = await Promise.all([
    loadPlayer(supabase, leftId),
    loadPlayer(supabase, rightId),
    loadPlayerTotals(supabase, leftId),
    loadPlayerTotals(supabase, rightId),
  ]);
  if (!leftPlayer || !rightPlayer) return null;
  return buildPlayerComparisonCard(
    { player: leftPlayer, totals: leftTotals },
    { player: rightPlayer, totals: rightTotals },
    PLAYER_WINDOW_LABEL,
  );
}

async function loadPrediction(
  supabase: Client,
  fixtureId: string,
  profileId: string | null,
): Promise<ShareCardData | null> {
  if (!profileId) return null;

  const [{ data: prediction }, fixture, { data: profile }] = await Promise.all([
    supabase
      .from("predictions")
      // Migration 0079 gave `predictions` six types; a share card is about
      // the winner pick, which is the only one whose whole meaning is
      // "home / draw / away". Scoped here rather than left to chance so the
      // card can never render a scoreline prediction as an outcome.
      .select("predicted_outcome, points_awarded")
      .eq("fixture_id", fixtureId)
      .eq("profile_id", profileId)
      .eq("prediction_type", "winner")
      .maybeSingle(),
    loadFixture(supabase, fixtureId),
    supabase
      .from("profiles")
      .select("display_name, username, avatar_type, avatar_kivo_id, avatar_uploaded_url, avatar_url")
      .eq("id", profileId)
      .maybeSingle(),
  ]);

  if (!prediction || prediction.predicted_outcome === null || !fixture || !profile) return null;

  return buildPredictionCard({ ...prediction, predicted_outcome: prediction.predicted_outcome }, fixture, {
    display_name: profile.display_name,
    username: profile.username,
    avatar_src: resolveAvatarSrc(profile),
  });
}

/**
 * A fantasy card is made from a real scored gameweek. No `fantasy_points` row
 * means the gameweek has not been scored, and an unscored gameweek gets no
 * card rather than a zero — a 0-point card would read as a bad week when what
 * actually happened is that nothing has been calculated yet.
 */
async function loadFantasyPerformance(
  supabase: Client,
  fantasyTeamId: string,
  profileId: string | null,
): Promise<ShareCardData | null> {
  if (!profileId) return null;

  const { data: teamRow } = await supabase
    .from("fantasy_teams")
    .select("id, name, league_id, owner_profile_id, owner:profiles!fantasy_teams_owner_profile_id_fkey(username, display_name)")
    .eq("id", fantasyTeamId)
    .maybeSingle();
  if (!teamRow) return null;

  const { data: latest } = await supabase
    .from("fantasy_points")
    .select("points, gameweek:fantasy_gameweeks(id, number)")
    .eq("fantasy_team_id", fantasyTeamId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const scored = latest as unknown as { points: number; gameweek: { id: string; number: number } | null } | null;
  if (!scored?.gameweek) return null;

  // The standing comes from `get_fantasy_league_leaderboard`, and it has to:
  // `fantasy_points` is RLS-scoped to the owning manager, so a direct read of
  // rival teams' scores returns nothing at all (verified against the seeded
  // database — a hand-rolled cross-team query came back with one row, this
  // viewer's own). That RPC is the SECURITY DEFINER aggregate built for
  // exactly this, and it is the only honest source.
  //
  // What it returns is **season totals**, and the first version of this card
  // printed them beside a gameweek score: "36 gameweek points", "league
  // average 80", "1st of 2". Three real numbers arranged into a
  // contradiction, because two measured a season and one measured a week,
  // and nothing on the card said so. Caught by looking at a rendered card.
  //
  // So: the standing stays and now says which season it is a standing in,
  // and the average is gone. There is no per-gameweek league average this
  // viewer is allowed to compute, and an average on a different basis to the
  // number above it is worse than no average.
  const [{ data: leaderboard }, { count: squadSize }, { data: league }] = await Promise.all([
    supabase.rpc("get_fantasy_league_leaderboard", { p_team_id: fantasyTeamId }),
    supabase
      .from("fantasy_rosters")
      .select("id", { count: "exact", head: true })
      .eq("fantasy_team_id", fantasyTeamId)
      .eq("gameweek_id", scored.gameweek.id),
    supabase.from("fantasy_leagues").select("name").eq("id", teamRow.league_id).maybeSingle(),
  ]);

  const rows = (leaderboard ?? []) as { team_id: string; total_points: number; has_scores: boolean }[];
  const scoredRows = rows.filter((row) => row.has_scores);
  const rankIndex = scoredRows.findIndex((row) => row.team_id === fantasyTeamId);

  // A league of one has nobody to be ranked against: "1st of 1" is true and
  // says nothing.
  const comparable = scoredRows.length > 1 && rankIndex >= 0;

  const owner = teamRow.owner as unknown as { username: string; display_name: string | null } | null;

  return buildFantasyPerformanceCard({
    teamName: teamRow.name,
    managerName: owner?.display_name ?? (owner ? `@${owner.username}` : "KIVO manager"),
    gameweekNumber: scored.gameweek.number,
    gameweekName: null,
    points: scored.points,
    rank: comparable ? rankIndex + 1 : null,
    leagueName: league?.name ?? null,
    entriesInLeague: comparable ? scoredRows.length : null,
    // Deliberately never set: see above. The field stays on the input type
    // because a per-gameweek average is a real thing to add later, behind an
    // RPC that can compute it — not because one is available now.
    averagePoints: null,
    squadSize: squadSize && squadSize > 0 ? squadSize : null,
  });
}

async function loadLeagueTable(
  supabase: Client,
  seasonId: string,
  highlightTeamId: string | null,
): Promise<ShareCardData | null> {
  const { data: season } = await supabase
    .from("seasons")
    .select("name, competition:competitions(name)")
    .eq("id", seasonId)
    .maybeSingle();
  if (!season) return null;

  const { data: standings } = await supabase
    .from("standings")
    .select("position, played, goals_for, goals_against, points, team:teams(name, short_name, crest_url)")
    .eq("season_id", seasonId)
    .order("position", { ascending: true });

  let highlightTeamName: string | null = null;
  if (highlightTeamId) {
    const { data: team } = await supabase.from("teams").select("name").eq("id", highlightTeamId).maybeSingle();
    highlightTeamName = team?.name ?? null;
  }

  const competition = season.competition as unknown as { name: string } | null;

  return buildLeagueTableCard(
    competition?.name ?? "Competition",
    season.name,
    (standings ?? []) as unknown as StandingRow[],
    highlightTeamName,
  );
}

/**
 * Which provider actually recorded a transfer, read from `provider_mappings`
 * — the same table the sync layer writes when it upserts the row. Null when
 * nothing is mapped (a hand-corrected row, for instance), and the caller
 * falls back to naming KIVO's own sync rather than crediting a provider that
 * may not have supplied it.
 */
async function loadTransferSource(supabase: Client, transferId: string): Promise<string | null> {
  const { data } = await supabase
    .from("provider_mappings")
    .select("provider")
    .eq("entity_type", "transfer")
    .eq("kivo_entity_id", transferId)
    .maybeSingle();
  if (!data?.provider) return null;
  return PROVIDER_DISPLAY_NAME[data.provider] ?? data.provider;
}

async function loadTransfer(supabase: Client, transferId: string): Promise<ShareCardData | null> {
  const { data } = await supabase
    .from("transfers")
    .select(
      `transfer_date, fee_text, transfer_type,
       player:players(full_name, photo_url),
       from_team:teams!transfers_from_team_id_fkey(name, short_name, crest_url),
       to_team:teams!transfers_to_team_id_fkey(name, short_name, crest_url)`,
    )
    .eq("id", transferId)
    .maybeSingle();

  if (!data) return null;

  const row = data as unknown as TransferRow;
  return buildTransferCard(
    row,
    TRANSFER_TYPE_LABEL[row.transfer_type as keyof typeof TRANSFER_TYPE_LABEL] ?? "Transfer",
    // Real attribution, from the row that actually recorded the move, rather
    // than a hardcoded provider name that would keep saying "API-Football"
    // long after the data came from somewhere else.
    (await loadTransferSource(supabase, transferId)) ?? "KIVO",
  );
}

/**
 * An insight card carries a real Copilot answer the viewer actually received
 * — the assistant message row, verbatim (truncated, never re-summarised) —
 * together with the question that produced it. It is not a new generation and
 * it never runs the model: the point of the card is "here is what KIVO told
 * me", and re-asking would produce something the sharer never saw.
 */
async function loadAiInsight(
  supabase: Client,
  messageId: string,
  profileId: string | null,
): Promise<ShareCardData | null> {
  if (!profileId) return null;

  const { data: answer } = await supabase
    .from("ai_messages")
    .select("id, content, role, created_at, conversation_id")
    .eq("id", messageId)
    .maybeSingle();

  if (!answer || answer.role !== "assistant") return null;

  const { data: conversation } = await supabase
    .from("ai_conversations")
    .select("id, title, profile_id")
    .eq("id", answer.conversation_id)
    .maybeSingle();

  // RLS should already prevent this, but a card is a public artefact and the
  // ownership check is cheap — a second lock on the one door that matters.
  if (!conversation || conversation.profile_id !== profileId) return null;

  const { data: questionRows } = await supabase
    .from("ai_messages")
    .select("content, role, created_at")
    .eq("conversation_id", answer.conversation_id)
    .eq("role", "user")
    .lt("created_at", answer.created_at)
    .order("created_at", { ascending: false })
    .limit(1);

  const question = questionRows?.[0]?.content;
  if (!question) return null;

  return buildAiInsightCard({
    question,
    answer: answer.content,
    askedAt: answer.created_at,
    contextLabel: conversation.title,
  });
}

async function loadProfileAchievement(
  supabase: Client,
  profileId: string,
): Promise<ShareCardData | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "id, username, display_name, created_at, avatar_type, avatar_kivo_id, avatar_uploaded_url, avatar_url",
    )
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return null;

  const [{ data: statsRows }, { count: predictionsMade }, { count: correctPredictions }, { count: postsWritten }, { count: followingCount }] =
    await Promise.all([
      supabase.rpc("get_public_profile_stats", { p_profile_id: profileId }),
      supabase.from("predictions").select("id", { count: "exact", head: true }).eq("profile_id", profileId),
      supabase
        .from("predictions")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", profileId)
        .gt("points_awarded", 0),
      supabase.from("posts").select("id", { count: "exact", head: true }).eq("author_profile_id", profileId),
      supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_profile_id", profileId),
    ]);

  const stats = (statsRows ?? [])[0] as { total_xp: number; badges: unknown; is_public: boolean } | undefined;

  const badges = Array.isArray(stats?.badges)
    ? (stats.badges as { name?: unknown; description?: unknown }[])
        .map((badge) => ({
          name: typeof badge?.name === "string" ? badge.name : null,
          description: typeof badge?.description === "string" ? badge.description : null,
        }))
        .filter((badge): badge is { name: string; description: string | null } => badge.name !== null)
    : [];

  return buildProfileAchievementCard({
    displayName: profile.display_name,
    username: profile.username,
    avatarUrl: resolveAvatarSrc(profile),
    createdAt: profile.created_at,
    // `count` is null only when the query itself failed — that is "unknown",
    // and unknown is omitted rather than shown as none.
    totalXp: stats?.total_xp ?? null,
    predictionsMade: predictionsMade ?? null,
    correctPredictions: correctPredictions ?? null,
    postsWritten: postsWritten ?? null,
    followingCount: followingCount ?? null,
    badges,
  });
}

/* ------------------------------------------------------------------ */

export type ShareCardRequest = {
  kind: ShareCardKind;
  /** The primary entity: a fixture, player, season, transfer, fantasy team,
   * Copilot message or profile id, depending on the kind. */
  id: string;
  /** The second player on a comparison card, and the highlighted club on a
   * league-table card. Unused by every other kind. */
  secondaryId?: string | null;
  /** The signed-in viewer, for the four kinds that are about a person. */
  viewerProfileId?: string | null;
};

export async function loadShareCard(
  supabase: Client,
  request: ShareCardRequest,
): Promise<ShareCardData | null> {
  try {
    switch (request.kind) {
      case "live-score":
        return await loadLiveScore(supabase, request.id);
      case "player-performance":
        return await loadPlayerPerformance(supabase, request.id);
      case "player-comparison":
        return request.secondaryId
          ? await loadPlayerComparison(supabase, request.id, request.secondaryId)
          : null;
      case "prediction":
        return await loadPrediction(supabase, request.id, request.viewerProfileId ?? null);
      case "fantasy-performance":
        return await loadFantasyPerformance(supabase, request.id, request.viewerProfileId ?? null);
      case "league-table":
        return await loadLeagueTable(supabase, request.id, request.secondaryId ?? null);
      case "transfer":
        return await loadTransfer(supabase, request.id);
      case "ai-insight":
        return await loadAiInsight(supabase, request.id, request.viewerProfileId ?? null);
      case "profile-achievement":
        return await loadProfileAchievement(supabase, request.id);
    }
  } catch (error) {
    // A share card is never load-bearing for a page. A failure here means no
    // share affordance, not a broken match centre.
    logError(`share-cards.load.${request.kind}`, error);
    return null;
  }
}

export { PLAYED_STATUSES };
