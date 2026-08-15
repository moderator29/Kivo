import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/profile";
import { computeTeamForm, computePlayerForm, resolveFixtureResult, type ResolvedResult } from "@/lib/football/form-engine";
import { buildMatchInsights, type MatchInsights } from "@/lib/football/match-intelligence";

// RECOMMENDATIONS.md item 227: this pass's original enrichment scoped form to
// the favourite team only "to keep this one extra query bounded" — these two
// caps are that same bound applied to followed teams/players instead of
// skipping them, rather than lifted entirely. follows is itself already
// limited to 20 rows above, so this is a bound on top of a bound.
const MAX_FOLLOWED_TEAMS_FOR_FORM = 4;
const MAX_FOLLOWED_PLAYERS_FOR_FORM = 4;

export interface GroundingContext {
  /** Rendered as plain text and injected into the system prompt — kept small and structured on purpose. */
  summary: string;
  hasFollowedEntities: boolean;
  hasSyncedFixtures: boolean;
}

/**
 * Deterministic retrieval BEFORE the model ever runs, per the grounding
 * architecture: we tell the model exactly what KIVO actually knows right
 * now, and the system prompt (see chat route) forbids it from answering
 * specific/current football questions with anything outside this context.
 */
export async function buildGroundingContext(profile: Profile | null): Promise<GroundingContext> {
  if (!profile) {
    return { summary: "No signed-in user context available.", hasFollowedEntities: false, hasSyncedFixtures: false };
  }

  const supabase = createServerSupabaseClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: follows }, { data: favouriteTeam }, { data: todaysFixtures }] = await Promise.all([
    supabase
      .from("follows")
      .select("followed_type, followed_id")
      .eq("follower_profile_id", profile.id)
      .in("followed_type", ["team", "player", "competition"])
      .limit(20),
    profile.favourite_team_id
      ? supabase.from("teams").select("id, name").eq("id", profile.favourite_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("fixtures")
      .select("kickoff_at, status, home_score, away_score, home_team:teams!fixtures_home_team_id_fkey(name), away_team:teams!fixtures_away_team_id_fkey(name), competition:competitions(name)")
      .gte("kickoff_at", `${today}T00:00:00Z`)
      .lte("kickoff_at", `${today}T23:59:59Z`)
      .order("kickoff_at", { ascending: true })
      .limit(30),
  ]);

  // Resolve the polymorphic follows rows to real names. follows.followed_id
  // has no DB-level FK (see 0001_kivo_core_schema.sql's comment on the
  // `follows` table), so this is the same two-step "collect ids per type,
  // then batch-fetch each entity table" pattern already used by
  // src/app/(app)/profile/following/page.tsx for the same reason.
  const teamIds = (follows ?? []).filter((f) => f.followed_type === "team").map((f) => f.followed_id);
  const playerIds = (follows ?? []).filter((f) => f.followed_type === "player").map((f) => f.followed_id);
  const competitionIds = (follows ?? []).filter((f) => f.followed_type === "competition").map((f) => f.followed_id);

  const [{ data: followedTeams }, { data: followedPlayers }, { data: followedCompetitions }] = await Promise.all([
    teamIds.length
      ? supabase.from("teams").select("id, name").in("id", teamIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    playerIds.length
      ? supabase.from("players").select("id, full_name, known_as").in("id", playerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; known_as: string | null }[] }),
    competitionIds.length
      ? supabase.from("competitions").select("name").in("id", competitionIds)
      : Promise.resolve({ data: [] as { name: string }[] }),
  ]);

  // KIVO Form Engine (src/lib/football/form-engine.ts): the user's favourite
  // team's real recent form, when there is one and enough synced matches
  // exist to compute it honestly. Scoped to just the favourite team (not
  // every followed team) to keep this one extra query bounded regardless of
  // how many entities the user follows. Also captures the id of that team's
  // single most recent finished fixture (recentFixtures is already ordered
  // newest-first) so Match Intelligence below can ground it without a
  // second "find the latest match" query.
  let favouriteTeamMostRecentFixtureId: string | null = null;
  const favouriteTeamForm = favouriteTeam
    ? await (async () => {
        const { data: recentFixtures } = await supabase
          .from("fixtures")
          .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
          .or(`home_team_id.eq.${favouriteTeam.id},away_team_id.eq.${favouriteTeam.id}`)
          .eq("status", "finished")
          .order("kickoff_at", { ascending: false })
          .limit(10);
        favouriteTeamMostRecentFixtureId = recentFixtures?.[0]?.id ?? null;
        const resolved: ResolvedResult[] = (recentFixtures ?? [])
          .map((f) => resolveFixtureResult(f, favouriteTeam.id))
          .filter((r): r is ResolvedResult => r !== null);
        return computeTeamForm(resolved, "last5");
      })()
    : null;

  // KIVO Match Intelligence (src/lib/football/match-intelligence.ts): real
  // H2H + both sides' form + real goal-timing for the favourite team's most
  // recent finished match — this is what lets the Copilot answer something
  // like "why did Arsenal lose" from one coherent, real object instead of
  // guessing. Bounded to one fixture (not one per followed team) for the
  // same reason favouriteTeamForm above is scoped narrowly. null whenever
  // there's no favourite team or it has no finished match synced yet.
  const matchInsights: MatchInsights | null = favouriteTeamMostRecentFixtureId
    ? await buildMatchInsights(supabase, favouriteTeamMostRecentFixtureId)
    : null;

  // RECOMMENDATIONS.md item 227: the same real form computation above,
  // extended from "favourite team only" to every followed team (capped —
  // see MAX_FOLLOWED_TEAMS_FOR_FORM) and to followed players' recent
  // involvement, reusing players/[id]/page.tsx's lineups→
  // resolveFixtureResult→computePlayerForm pattern for the latter.
  const otherFollowedTeams = (followedTeams ?? [])
    .filter((t) => t.id !== profile.favourite_team_id)
    .slice(0, MAX_FOLLOWED_TEAMS_FOR_FORM);
  const followedTeamForms = await Promise.all(
    otherFollowedTeams.map(async (team) => {
      const { data: recentFixtures } = await supabase
        .from("fixtures")
        .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
        .or(`home_team_id.eq.${team.id},away_team_id.eq.${team.id}`)
        .eq("status", "finished")
        .order("kickoff_at", { ascending: false })
        .limit(10);
      const resolved: ResolvedResult[] = (recentFixtures ?? [])
        .map((f) => resolveFixtureResult(f, team.id))
        .filter((r): r is ResolvedResult => r !== null);
      return { team, form: computeTeamForm(resolved, "last5") };
    }),
  );

  const followedPlayersForForm = (followedPlayers ?? []).slice(0, MAX_FOLLOWED_PLAYERS_FOR_FORM);
  const followedPlayerForms = await Promise.all(
    followedPlayersForForm.map(async (player) => {
      const { data: lineupRows } = await supabase
        .from("lineups")
        .select("team_id, fixture:fixtures(id, status, kickoff_at, home_team_id, away_team_id, home_score, away_score)")
        .eq("player_id", player.id);
      const resolved: ResolvedResult[] = (lineupRows ?? [])
        .flatMap((row) => {
          if (!row.fixture) return [];
          const r = resolveFixtureResult(row.fixture, row.team_id);
          return r ? [r] : [];
        })
        .sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());
      return { player, form: computePlayerForm(resolved, "last5") };
    }),
  );

  const lines: string[] = [];
  lines.push(`User: @${profile.username}${favouriteTeam ? `, favourite team: ${favouriteTeam.name}` : ""}.`);
  if (favouriteTeam && favouriteTeamForm) {
    if (favouriteTeamForm.isSufficientSample) {
      lines.push(
        `${favouriteTeam.name}'s real recent form (last ${favouriteTeamForm.sampleSize} synced matches, newest first): ` +
          `${favouriteTeamForm.sequence.join(" ")} (${favouriteTeamForm.wins}W ${favouriteTeamForm.draws}D ${favouriteTeamForm.losses}L, ` +
          `${favouriteTeamForm.goalsScored} scored / ${favouriteTeamForm.goalsConceded} conceded). Use this if the user asks about their team's form.`,
      );
    } else {
      lines.push(
        `${favouriteTeam.name} has too few finished matches synced (${favouriteTeamForm.sampleSize}) for a reliable form trend — say so rather than guessing if asked about their form.`,
      );
    }
  }

  // KIVO Match Intelligence: real H2H, both sides' form, and real
  // goal-timing for the favourite team's most recent finished match — this
  // is the object that lets the Copilot answer "why did [team] lose/win"
  // from real evidence instead of speculation. Every sub-field degrades to
  // an honest "not enough data" sentence rather than a fabricated stat.
  if (favouriteTeam && matchInsights) {
    const isHome = matchInsights.homeTeam.id === favouriteTeam.id;
    const own = isHome ? matchInsights.homeTeam : matchInsights.awayTeam;
    const opp = isHome ? matchInsights.awayTeam : matchInsights.homeTeam;
    const ownGoalTiming = isHome ? matchInsights.homeGoalTiming : matchInsights.awayGoalTiming;

    lines.push(
      `${favouriteTeam.name}'s most recent finished match (kickoff ${matchInsights.kickoffAt}) was vs ${opp.name}. ` +
        `Use this specific match as the real evidence if the user asks something like "why did ${own.name} win/lose" — do not speculate beyond what's listed below.`,
    );

    if (matchInsights.headToHead && matchInsights.headToHead.meetings.length > 0) {
      const h2h = matchInsights.headToHead;
      const ownWins = isHome ? h2h.teamAWins : h2h.teamBWins;
      const oppWins = isHome ? h2h.teamBWins : h2h.teamAWins;
      lines.push(
        `Real head-to-head history vs ${opp.name} (${h2h.meetings.length} prior synced meetings, excluding the match above): ` +
          `${own.name} ${ownWins}W ${h2h.draws}D ${oppWins}L.`,
      );
    } else {
      lines.push(`No prior head-to-head meetings between ${own.name} and ${opp.name} are synced yet.`);
    }

    if (ownGoalTiming.isSufficientSample) {
      lines.push(
        `${own.name}'s real goal-timing split: ${ownGoalTiming.goalsAfter70} of ${ownGoalTiming.goalsScored} goals scored after the 70th minute ` +
          `(based on ${ownGoalTiming.finishedMatchesSample} finished matches synced).`,
      );
    } else {
      lines.push(`${own.name} has too few finished matches synced for a reliable goal-timing split — say so if asked.`);
    }
  }

  // A followed row whose target was since deleted resolves to nothing here
  // (same caveat as the following page) and is simply dropped rather than
  // listed as a broken reference.
  const followedNames = [
    ...(followedTeams ?? []).map((t) => `${t.name} (team)`),
    ...(followedPlayers ?? []).map((p) => `${p.known_as ?? p.full_name} (player)`),
    ...(followedCompetitions ?? []).map((c) => `${c.name} (competition)`),
  ];

  if (followedNames.length > 0) {
    lines.push(`Follows: ${followedNames.join(", ")}.`);
  } else {
    lines.push("Has not followed any teams, players or competitions yet.");
  }

  // Item 227: real recent form for followed teams and players beyond the
  // favourite team, same honest "too few matches" fallback as above.
  for (const { team, form } of followedTeamForms) {
    if (form.isSufficientSample) {
      lines.push(
        `${team.name}'s (followed) real recent form (last ${form.sampleSize} synced matches, newest first): ` +
          `${form.sequence.join(" ")} (${form.wins}W ${form.draws}D ${form.losses}L).`,
      );
    } else {
      lines.push(`${team.name} (followed) has too few finished matches synced (${form.sampleSize}) for a reliable form trend.`);
    }
  }
  for (const { player, form } of followedPlayerForms) {
    const displayName = player.known_as ?? player.full_name;
    if (form.isSufficientSample) {
      lines.push(
        `${displayName}'s (followed player) team result in their last ${form.sampleSize} synced appearances: ` +
          `${form.sequence.join(" ")} (${form.wins}W ${form.draws}D ${form.losses}L).`,
      );
    } else {
      lines.push(`${displayName} (followed player) has too few synced appearances for a reliable recent-form trend.`);
    }
  }

  if (todaysFixtures && todaysFixtures.length > 0) {
    lines.push(`Today's synced fixtures (${todaysFixtures.length}):`);
    for (const f of todaysFixtures.slice(0, 15)) {
      const home = f.home_team?.name ?? "Unknown";
      const away = f.away_team?.name ?? "Unknown";
      const comp = f.competition?.name ?? "Unknown competition";
      const score = f.home_score != null && f.away_score != null ? ` (${f.home_score}-${f.away_score})` : "";
      lines.push(`- ${home} vs ${away}${score} — ${comp}, status: ${f.status}`);
    }
  } else {
    lines.push(
      "No fixtures are synced into KIVO's database yet. The football data provider integration exists but no sync has populated real matches. Do not invent fixtures, scores, or standings.",
    );
  }

  return {
    summary: lines.join("\n"),
    hasFollowedEntities: followedNames.length > 0,
    hasSyncedFixtures: !!todaysFixtures && todaysFixtures.length > 0,
  };
}
