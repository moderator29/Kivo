import "server-only";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { awardBadge } from "@/lib/rewards";
import { logError } from "@/lib/log";
import { notifyFantasyGameweekOutcome } from "@/lib/fantasy-notifications";
import {
  groupFixturesByGameweek,
  carryForwardMissingFantasyRosters,
  ensureFantasyPlayerPrices,
  getFantasyPriceMap,
} from "@/lib/fantasy";
import {
  computePlayerMatchFacts,
  emptyPlayerMatchFacts,
  parseScoringRules,
  scoreRosterSlotBreakdown,
  SCORING_MODEL_VERSION,
  type FinishedFixtureFacts,
  type FixtureEventType,
  type ScoringRules,
} from "@/lib/fantasy-scoring";
import { computeGameweekPricingPoints, computePriceNudges, applyPriceNudge } from "@/lib/fantasy-pricing";
import { DEFAULT_FANTASY_PRICE } from "@/app/(app)/fantasy/fantasy-rules";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type ServiceClient = SupabaseClient<Database>;

/**
 * The fantasy gameweek scorer, as a plain function.
 *
 * ## Why it lives here rather than in the admin actions file
 *
 * It used to be the body of `scoreFantasyGameweek`, in a module with
 * `"use server"` at the top. Every export of such a module is a SERVER ACTION,
 * reachable by anybody who can POST to the app — which is fine for a function
 * that opens with an admin check, and is not fine for the same function with
 * the check removed so a background worker can call it. Extracting it here,
 * into an ordinary `server-only` module, is what makes an unauthenticated
 * caller structurally unable to reach it.
 *
 * **This function performs no authorisation.** That is deliberate and it is the
 * contract: every caller gates itself. Today there are two — the admin action,
 * which checks `canManageFootballData`, and the live worker, which is behind
 * `CRON_SECRET` and the scheduled-sync guards.
 *
 * It spends no provider quota. Every input is read from KIVO's own tables.
 */
export type ScoreFantasyGameweekResult = {
  error: string | null;
  recordsProcessed?: number;
  fixturesFinished?: number;
  fixturesTotal?: number;
  /** How many of the FINISHED fixtures actually have synced match events. A
   * finished fixture with none scores every player as if nothing happened, so
   * this being short of `fixturesFinished` is the signal that a total may be
   * under-counted. */
  fixturesWithEvents?: number;
  /** 'final' only when every fixture has finished AND every finished fixture
   * has events. */
  status?: "provisional" | "final";
  /** RECOMMENDATIONS.md item 251: how many real players had their
   * fantasy_player_prices row nudged by this run. */
  playersRepriced?: number;
  /** Which players those were, so a caller with a request context can
   * invalidate exactly their pages. Returned rather than acted on here — see
   * `applyFantasyPriceNudges`. */
  repricedPlayerIds?: string[];
};

/**
 * RECOMMENDATIONS.md item 251: real, bounded fantasy-price movement, run as
 * the last step of scoreFantasyGameweek so a price only ever moves off the
 * back of a gameweek whose real match data has actually landed. See
 * src/lib/fantasy-pricing.ts for the pure formula this wraps; this function
 * is purely the DB plumbing around it — load real lineups/events for the
 * gameweek's finished fixtures, compute each involved player's real
 * accumulated points, nudge their price relative to their position-group
 * peers, and write only the prices that actually changed.
 *
 * Deliberately reads `lineups` (the real match XI), not `fantasy_rosters`
 * (one manager's own pick) — pricing has to cover every real player who
 * played, not only whichever ones happen to be in someone's fantasy squad
 * today, the same reasoning LineupsTab's "In your XI" cross-reference (item
 * 294) keeps the two tables separate for. Runs under the service-role client
 * scoreFantasyGameweek already created, for the same reason the rest of that
 * function does: this writes rows across every player in the gameweek, not
 * just one caller's own.
 */
async function applyFantasyPriceNudges(
  service: ServiceClient,
  seasonId: string,
  finishedFixtureIds: string[],
  events: { fixture_id: string; player_id: string | null; related_player_id: string | null; event_type: FixtureEventType }[],
  finishedFixtureFacts: FinishedFixtureFacts[],
): Promise<{ playersRepriced: number; repricedPlayerIds: string[] }> {
  if (finishedFixtureIds.length === 0) return { playersRepriced: 0, repricedPlayerIds: [] };

  // Real starts only — a benched, unused substitute has no real evidence of
  // having actually played (same "no minutes-played column" reasoning
  // rating-engine.ts's hasEvidenceOfInvolvement already documents), so it
  // isn't a fair signal to price a player up or down on.
  const { data: lineupRows, error: lineupsError } = await service
    .from("lineups")
    .select("player_id")
    .in("fixture_id", finishedFixtureIds)
    .eq("is_starting", true);
  if (lineupsError) {
    logError("admin.data-health.fantasy-actions.loadLineupsFantasyPrice", lineupsError);
    return { playersRepriced: 0, repricedPlayerIds: [] };
  }
  if (!lineupRows || lineupRows.length === 0) return { playersRepriced: 0, repricedPlayerIds: [] };

  const startsByPlayer = new Map<string, number>();
  for (const row of lineupRows) {
    startsByPlayer.set(row.player_id, (startsByPlayer.get(row.player_id) ?? 0) + 1);
  }

  const involvedPlayerIds = [...startsByPlayer.keys()];
  const { data: players, error: playersError } = await service
    .from("players")
    .select("id, position, current_team_id")
    .in("id", involvedPlayerIds);
  if (playersError || !players || players.length === 0) {
    if (playersError) logError("admin.data-health.fantasy-actions.loadPlayersFantasyPrice", playersError);
    return { playersRepriced: 0, repricedPlayerIds: [] };
  }

  const playerTeamId = new Map(
    players.filter((p) => p.current_team_id).map((p) => [p.id, p.current_team_id as string]),
  );
  const facts = computePlayerMatchFacts(events, finishedFixtureFacts, playerTeamId);

  const pricingInputs = players.map((p) => ({
    playerId: p.id,
    position: p.position,
    points: computeGameweekPricingPoints(facts.get(p.id) ?? emptyPlayerMatchFacts(), startsByPlayer.get(p.id) ?? 0, p.position),
  }));

  const nudges = computePriceNudges(pricingInputs);
  if (nudges.length === 0) return { playersRepriced: 0, repricedPlayerIds: [] };

  // Lazily backfill the flat default for any of these players who don't yet
  // have a fantasy_player_prices row for this season (mirrors every other
  // caller of ensureFantasyPlayerPrices), then read whatever their real
  // current price is — the nudge always applies on top of the real stored
  // price, never a re-derivation from scratch, so price history compounds
  // gameweek over gameweek the way a real fantasy game's prices do.
  await ensureFantasyPlayerPrices(seasonId, involvedPlayerIds);
  const currentPrices = await getFantasyPriceMap(seasonId, involvedPlayerIds);

  const priceUpdates = nudges
    .map((n) => {
      const current = currentPrices.get(n.playerId) ?? DEFAULT_FANTASY_PRICE;
      const next = applyPriceNudge(current, n.delta);
      return { player_id: n.playerId, season_id: seasonId, price: next, current };
    })
    // Only write real, non-zero movement — a nudge that rounds to the same
    // stored price (e.g. a lone player in their position group, or a delta
    // too small to move the tenths digit) is a genuine no-op, not a write.
    .filter((row) => Math.abs(row.price - row.current) > 1e-9)
    .map(({ player_id, season_id, price }) => ({ player_id, season_id, price }));

  if (priceUpdates.length === 0) return { playersRepriced: 0, repricedPlayerIds: [] };

  const { error: priceError } = await service
    .from("fantasy_player_prices")
    .upsert(priceUpdates, { onConflict: "player_id,season_id" });
  if (priceError) {
    logError("fantasy.scoring.applyFantasyPriceNudges", priceError);
    return { playersRepriced: 0, repricedPlayerIds: [] };
  }

  // The repriced ids are RETURNED rather than revalidated here, and that is a
  // consequence of this module no longer being a server action: `revalidatePath`
  // is a request-scoped Next.js API, and this function now also runs from a
  // background worker where there is no request to invalidate against. The
  // admin action revalidates; the worker does not need to, because nothing is
  // rendered inside it.
  return {
    playersRepriced: priceUpdates.length,
    repricedPlayerIds: priceUpdates.map((row) => row.player_id),
  };
}

/**
 * Loads the rule VALUES for the version this release scores under.
 *
 * ## Why this refuses rather than falling back
 *
 * The obvious fallback — "row missing, use the constants in
 * `fantasy-scoring.ts`" — is wrong in a way that only shows up later. Today
 * those constants ARE version 1.0, so the fallback would be harmless and
 * invisible. The moment somebody bumps `SCORING_MODEL_VERSION` to 1.1 and the
 * matching ruleset row has not been applied, the same fallback silently scores
 * a gameweek with 1.1's formula, 1.0's numbers, and a 1.1 stamp on the row —
 * a score no version can explain, discovered by a manager arguing about it.
 *
 * So a missing or unreadable ruleset stops the scoring run with a message that
 * names the fix. `parseScoringRules` returns null rather than a
 * partially-defaulted object for the same reason: a ruleset with one field
 * filled in from somewhere else is a hybrid nobody declared.
 */
async function loadScoringRules(
  supabase: ServiceClient,
): Promise<{ rules: ScoringRules; error: null } | { rules: null; error: string }> {
  const { data, error } = await supabase
    .from("fantasy_scoring_rulesets")
    .select("rules")
    .eq("version", SCORING_MODEL_VERSION)
    .maybeSingle();

  if (error) {
    logError("admin.data-health.fantasy-actions.loadScoringRuleset", error);
    return { rules: null, error: "Couldn't read the scoring rules. Try again." };
  }
  if (!data) {
    return {
      rules: null,
      error: `No stored ruleset for scoring version ${SCORING_MODEL_VERSION}. Apply the migration that seeds it before scoring — a gameweek must not be scored under rules KIVO cannot show a manager.`,
    };
  }

  const rules = parseScoringRules(data.rules);
  if (!rules) {
    return {
      rules: null,
      error: `The stored ruleset for version ${SCORING_MODEL_VERSION} is incomplete or malformed, so scoring would use a mixture of rulesets. Fix the fantasy_scoring_rulesets row before scoring.`,
    };
  }
  return { rules, error: null };
}

export async function runGameweekScoring(gameweekId: string): Promise<ScoreFantasyGameweekResult> {
  // Reads that the admin action used to make on its own client are made here on
  // the service-role one. This function has NO caller-facing authorisation of
  // its own by design — it is not a server action and cannot be reached from a
  // browser; every caller is responsible for its own gate. See the module doc.
  const supabase = createServiceRoleSupabaseClient();

  const { data: gameweek, error: gwError } = await supabase
    .from("fantasy_gameweeks")
    .select("id, season_id, number")
    .eq("id", gameweekId)
    .maybeSingle();
  if (gwError || !gameweek) {
    return { error: "That gameweek doesn't exist." };
  }

  // Same source and ordering generateFantasyGameweeks used to create this
  // gameweek's row in the first place — see groupFixturesByGameweek's doc
  // comment for why this has to target the identical fixture set.
  const { data: seasonFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, matchday, kickoff_at, status, home_team_id, away_team_id, home_score, away_score")
    .eq("season_id", gameweek.season_id)
    .order("kickoff_at", { ascending: true });

  if (fixturesError) {
    logError("admin.data-health.fantasy-actions.loadFixturesGameweekScoring", fixturesError);
    return { error: "Couldn't load this season's fixtures. Try again." };
  }
  if (!seasonFixtures || seasonFixtures.length === 0) {
    return { error: "This season has no synced fixtures yet." };
  }

  const groups = groupFixturesByGameweek(seasonFixtures);
  const group = groups.get(gameweek.number);
  if (!group || group.fixtureIds.length === 0) {
    return { error: "Couldn't find this gameweek's fixtures. Try re-running Generate gameweeks." };
  }

  const groupFixtureIds = new Set(group.fixtureIds);
  const fixturesInGroup = seasonFixtures.filter((f) => groupFixtureIds.has(f.id));
  const finishedFixtures = fixturesInGroup.filter(
    (f) => f.status === "finished" && f.home_score !== null && f.away_score !== null,
  );

  if (finishedFixtures.length === 0) {
    return { error: null, recordsProcessed: 0, fixturesFinished: 0, fixturesTotal: fixturesInGroup.length };
  }

  const finishedFixtureIds = finishedFixtures.map((f) => f.id);
  const finishedFixtureFacts: FinishedFixtureFacts[] = finishedFixtures.map((f) => ({
    id: f.id,
    homeTeamId: f.home_team_id,
    awayTeamId: f.away_team_id,
    homeScore: f.home_score as number,
    awayScore: f.away_score as number,
  }));

  const service = createServiceRoleSupabaseClient();

  // Before any work: the rules this run will score under. Refused rather than
  // defaulted — see loadScoringRules.
  const ruleset = await loadScoringRules(service);
  if (ruleset.rules === null) return { error: ruleset.error };
  const rules = ruleset.rules;

  // A team whose owner hasn't opened /fantasy since this gameweek turned
  // current still has zero fantasy_rosters rows here — carryForwardFantasyRoster
  // (src/lib/fantasy.ts) only runs lazily per-viewer on page load. Carry every
  // still-empty team in this season forward before reading rosters below, so
  // scoring treats "never touched this gameweek" the same way every real
  // fantasy game does: kept the same squad, not fielded no one. See
  // RECOMMENDATIONS.md item 17.
  const { carried } = await carryForwardMissingFantasyRosters(service, gameweek.season_id, gameweekId, gameweek.number);

  const { data: events, error: eventsError } = await service
    .from("fixture_events")
    .select("fixture_id, player_id, related_player_id, event_type")
    .in("fixture_id", finishedFixtureIds);
  if (eventsError) {
    logError("admin.data-health.fantasy-actions.loadFixtureEventsGameweek", eventsError);
    return { error: "Couldn't load match events. Try again." };
  }

  /**
   * The count that closes the silent-wrong-score hole.
   *
   * A finished fixture with no rows in `fixture_events` produces EXACTLY the
   * same points as a real goalless, cardless match: the scorer sees no events
   * either way, so every player in it gets the appearance point and nothing
   * else. A hat-trick in an unsynced fixture is indistinguishable from a 0-0.
   *
   * Counting how many finished fixtures actually carry events is the only thing
   * that can tell those two apart — and it deliberately does NOT claim which
   * one it is. A genuinely eventless match is rare but real, so this is a
   * signal the UI explains ("2 of 10 finished matches have no events synced"),
   * not a verdict. What it does guarantee is that a score built on it is never
   * presented as settled.
   */
  const fixturesWithEvents = new Set((events ?? []).map((event) => event.fixture_id)).size;

  // RECOMMENDATIONS.md item 251: deliberately run before the fantasy-rosters
  // read below, and independent of it — real prices are about every real
  // player who actually played this gameweek, not just the ones someone
  // happens to have already rostered, so this must not be skipped by the
  // "no fantasy_rosters rows yet" early return a few lines down (e.g. a
  // season's very first gameweek, before anyone has built a squad). See
  // applyFantasyPriceNudges' own doc comment.
  const { playersRepriced, repricedPlayerIds } = await applyFantasyPriceNudges(
    service,
    gameweek.season_id,
    finishedFixtureIds,
    events ?? [],
    finishedFixtureFacts,
  );

  const { data: rosterRows, error: rosterError } = await service
    .from("fantasy_rosters")
    .select("fantasy_team_id, player_id, is_starting, is_captain, is_vice_captain")
    .eq("gameweek_id", gameweekId);
  if (rosterError) {
    logError("admin.data-health.fantasy-actions.loadFantasyRostersGameweek", rosterError);
    return { error: "Couldn't load fantasy squads. Try again." };
  }

  const rosters = rosterRows ?? [];
  if (rosters.length === 0) {
    return {
      error: null,
      recordsProcessed: 0,
      fixturesFinished: finishedFixtures.length,
      fixturesTotal: fixturesInGroup.length,
      playersRepriced,
    };
  }

  const rosteredPlayerIds = [...new Set(rosters.map((r) => r.player_id))];
  const { data: players, error: playersError } = await service
    .from("players")
    .select("id, position, current_team_id")
    .in("id", rosteredPlayerIds);
  if (playersError) {
    logError("admin.data-health.fantasy-actions.loadPlayersGameweekScoring", playersError);
    return { error: "Couldn't load player data. Try again." };
  }

  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  // Player's team, for crediting clean sheets — current_team_id is the same
  // "player's team" signal the rest of the fantasy UI already relies on
  // (see fantasy-builder's roster join in src/app/(app)/fantasy/page.tsx).
  const playerTeamId = new Map(
    (players ?? []).filter((p) => p.current_team_id).map((p) => [p.id, p.current_team_id as string]),
  );

  const facts = computePlayerMatchFacts(events ?? [], finishedFixtureFacts, playerTeamId);

  /**
   * Transfer hits taken for this gameweek, by team.
   *
   * Read rather than recomputed: the cost was decided at save time against the
   * previous gameweek's squad, and recomputing it now — after the roster has
   * been carried forward and possibly rewritten — would produce a different
   * number from the one the manager was told when they saved. The stored row is
   * the record of what they agreed to.
   */
  const { data: transferRows, error: transfersError } = await service
    .from("fantasy_transfers")
    .select("fantasy_team_id, points_cost")
    .eq("gameweek_id", gameweekId);
  if (transfersError) {
    logError("admin.data-health.fantasy-actions.loadFantasyTransfers", transfersError);
  }
  const transferCostByTeam = new Map<string, number>();
  for (const row of transferRows ?? []) {
    transferCostByTeam.set(row.fantasy_team_id, (transferCostByTeam.get(row.fantasy_team_id) ?? 0) + row.points_cost);
  }

  // See fantasy-scoring.ts's LIMITATION note: "did the captain play" is
  // approximated by the captain's own fantasy_rosters.is_starting flag for
  // this gameweek. A team with no captain set defaults to "didn't play" so
  // its vice-captain (if any) still gets a shot at the double.
  const captainStartingByTeam = new Map<string, boolean>();
  for (const row of rosters) {
    if (row.is_captain) captainStartingByTeam.set(row.fantasy_team_id, row.is_starting);
  }

  const pointsByTeam = new Map<string, number>();
  const breakdownRows: Database["public"]["Tables"]["fantasy_point_breakdowns"]["Insert"][] = [];

  for (const row of rosters) {
    if (!pointsByTeam.has(row.fantasy_team_id)) pointsByTeam.set(row.fantasy_team_id, 0);

    const player = playerById.get(row.player_id);
    const playerFacts = facts.get(row.player_id) ?? emptyPlayerMatchFacts();
    const captainStarted = captainStartingByTeam.get(row.fantasy_team_id) ?? false;

    const slot = scoreRosterSlotBreakdown(
      playerFacts,
      player?.position ?? null,
      {
        isStarting: row.is_starting,
        isCaptain: row.is_captain,
        doubleAsVice: row.is_vice_captain && !captainStarted,
      },
      rules,
    );

    pointsByTeam.set(row.fantasy_team_id, pointsByTeam.get(row.fantasy_team_id)! + slot.total);

    // Both the counts and the points they produced. Storing one without the
    // other makes the other unverifiable — see fantasy_point_breakdowns'
    // table comment (migration 0095).
    breakdownRows.push({
      fantasy_team_id: row.fantasy_team_id,
      gameweek_id: gameweekId,
      player_id: row.player_id,
      is_starting: row.is_starting,
      multiplier: slot.multiplier,
      goals: playerFacts.goals,
      assists: playerFacts.assists,
      own_goals: playerFacts.ownGoals,
      yellow_cards: playerFacts.yellowCards,
      red_cards: playerFacts.redCards,
      clean_sheets: playerFacts.cleanSheets,
      appearance_points: slot.appearancePoints,
      goal_points: slot.goalPoints,
      assist_points: slot.assistPoints,
      own_goal_points: slot.ownGoalPoints,
      card_points: slot.cardPoints,
      clean_sheet_points: slot.cleanSheetPoints,
      total_points: slot.total,
      scoring_model_version: SCORING_MODEL_VERSION,
    });
  }

  /**
   * `final` is a claim, so it is only made when both halves of it are true:
   * every fixture in the gameweek has finished, AND every finished fixture has
   * match events synced. Anything else stays `provisional`.
   *
   * The second condition is deliberately conservative. A genuinely eventless
   * match — 0-0, no cards — would hold a gameweek at `provisional` forever,
   * which is mildly unsatisfying and is the right way round: under-claiming
   * costs a caveat on screen, over-claiming means telling a manager their score
   * is settled while a hat-trick is missing from it. The counts are stored
   * alongside so the UI can say precisely which fixtures are short rather than
   * leaving "provisional" unexplained.
   */
  const computedAt = new Date().toISOString();
  const isComplete =
    finishedFixtures.length === fixturesInGroup.length && fixturesWithEvents === finishedFixtures.length;

  const upsertRows = [...pointsByTeam.entries()].map(([fantasy_team_id, slotPoints]) => {
    // Kept as its own column rather than folded into `points`, so the itemised
    // breakdown still reconciles: sum(breakdown.total_points) +
    // transfer_points_cost = points. A hit baked invisibly into the total is
    // four points a manager cannot account for.
    const transferCost = transferCostByTeam.get(fantasy_team_id) ?? 0;
    return {
    fantasy_team_id,
    gameweek_id: gameweekId,
    points: slotPoints + transferCost,
    transfer_points_cost: transferCost,
    // RECOMMENDATIONS.md item 308: stamp the real ruleset version that
    // produced this row (migration 0052) — see fantasy-scoring.ts's own
    // doc comment on SCORING_MODEL_VERSION.
    scoring_model_version: SCORING_MODEL_VERSION,
    status: isComplete ? "final" : "provisional",
    fixtures_total: fixturesInGroup.length,
    fixtures_finished: finishedFixtures.length,
    fixtures_with_events: fixturesWithEvents,
    computed_at: computedAt,
    };
  });

  const { error: upsertError } = await service
    .from("fantasy_points")
    .upsert(upsertRows, { onConflict: "fantasy_team_id,gameweek_id" });
  if (upsertError) {
    logError("admin.data-health.fantasy-actions.writeFantasyPoints", upsertError);
    return { error: "Couldn't save fantasy points. Try again." };
  }

  /**
   * The itemisation, written after the totals so a failure here cannot leave a
   * gameweek unscored — the total is the thing managers act on, the breakdown
   * is how they check it.
   *
   * Stale rows are cleared first rather than left: a player transferred out
   * between two runs of this scorer would otherwise keep a breakdown row that
   * no longer corresponds to any roster slot, and the breakdown's whole value
   * is that its totals sum to the team's score.
   */
  const { error: clearBreakdownError } = await service
    .from("fantasy_point_breakdowns")
    .delete()
    .eq("gameweek_id", gameweekId);
  if (clearBreakdownError) {
    logError("admin.data-health.fantasy-actions.clearFantasyBreakdowns", clearBreakdownError);
  } else if (breakdownRows.length > 0) {
    const { error: breakdownError } = await service
      .from("fantasy_point_breakdowns")
      .upsert(breakdownRows, { onConflict: "fantasy_team_id,gameweek_id,player_id" });
    if (breakdownError) {
      // Not fatal, and deliberately so: the points are correct and already
      // written. A missing breakdown makes the score unexplained, which the UI
      // says honestly (computed_at is set but no rows exist), rather than
      // making it wrong.
      logError("admin.data-health.fantasy-actions.writeFantasyBreakdowns", breakdownError);
    }
  }

  // KN-61: tell the managers. Until now a squad could be carried forward for
  // somebody who never opened the app, scored, and land on a leaderboard with
  // the owner none the wiser unless they thought to visit /fantasy and read a
  // badge. One notification each, merging "we kept your squad" and "here's what
  // it scored" into a single line when both are true — see
  // notifyFantasyGameweekOutcome. Best-effort by design: the points are the
  // work, this is the telling, and a failed insert must not fail the run.
  const carriedFromByTeam = new Map(carried.map((entry) => [entry.fantasyTeamId, entry]));
  const pointsByTeamId = new Map(upsertRows.map((row) => [row.fantasy_team_id, row.points]));
  const notifiableTeamIds = [...new Set([...pointsByTeamId.keys(), ...carriedFromByTeam.keys()])];

  if (notifiableTeamIds.length > 0) {
    const { data: notifiableTeams, error: notifiableTeamsError } = await service
      .from("fantasy_teams")
      .select("id, owner_profile_id")
      .in("id", notifiableTeamIds);
    if (notifiableTeamsError) {
      logError("admin.data-health.fantasy-actions.loadOwnersForGameweekNotices", notifiableTeamsError);
    } else {
      await notifyFantasyGameweekOutcome(
        service,
        (notifiableTeams ?? []).map((team) => ({
          ownerProfileId: team.owner_profile_id,
          gameweekId,
          fantasyTeamId: team.id,
          gameweekNumber: gameweek.number,
          points: pointsByTeamId.get(team.id) ?? null,
          carriedFromGameweekNumber: carriedFromByTeam.get(team.id)?.fromGameweekNumber ?? null,
        })),
      );
    }
  }

  // "Scored" means a real positive fantasy_points row just written above —
  // never awarded for a zero or unplayed gameweek. Resolve team -> owner via
  // fantasy_teams (fantasy_points has no profile_id column of its own).
  const scoringTeamIds = upsertRows.filter((r) => r.points > 0).map((r) => r.fantasy_team_id);
  if (scoringTeamIds.length > 0) {
    const { data: scoringTeams, error: scoringTeamsError } = await service
      .from("fantasy_teams")
      .select("id, owner_profile_id")
      .in("id", scoringTeamIds);
    if (scoringTeamsError) {
      logError("admin.data-health.fantasy-actions.loadFantasyTeamOwners", scoringTeamsError);
    } else {
      await Promise.all((scoringTeams ?? []).map((t) => awardBadge(t.owner_profile_id, "fantasy_gameweek_scored")));
    }
  }


  return {
    error: null,
    recordsProcessed: upsertRows.length,
    fixturesFinished: finishedFixtures.length,
    fixturesTotal: fixturesInGroup.length,
    fixturesWithEvents,
    status: isComplete ? "final" : "provisional",
    playersRepriced,
    repricedPlayerIds,
  };
}
