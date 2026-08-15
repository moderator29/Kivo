/**
 * KIVO Rating Engine calibration tool — RECOMMENDATIONS.md items 225/229,
 * docs/RATING_ENGINE.md.
 *
 * WHAT THIS IS
 * ------------
 * `src/lib/football/rating-engine.ts` is unit-tested against hand-built
 * inputs only. Its weights (`RATING_WEIGHTS`) are reasoned defaults that
 * extend `fantasy-scoring.ts`'s existing position-weighting convention —
 * they have never been checked against a single real match. This script is
 * the calibration *pass itself*: it pulls every real, already-synced
 * finished fixture's lineups + events + final score from the live database,
 * computes `kivoRating` for each real player-match via the unmodified,
 * already-shipped engine, and prints a statistical summary a human reviews
 * to decide whether the model is trustworthy enough to wire into a UI
 * (item 229 is explicitly blocked on that human decision, not on this
 * script existing).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * -----------------------------------
 *  - It never invents, seeds, or simulates a single fixture/lineup/event —
 *    every input row comes from a real `select` against the live project.
 *  - It never edits `RATING_WEIGHTS` or any other model constant. If a human
 *    reviewing this report later decides a weight should change, that is a
 *    deliberate, reviewed edit to rating-engine.ts, not something this
 *    script does automatically or silently.
 *  - It never writes anything back to the database — read-only throughout.
 *  - When the live project has no (or too little) real finished-fixture
 *    data, it says so in plain language and stops. It does NOT fall back to
 *    synthetic data dressed up as "calibration data" — that would be
 *    exactly the fabrication the standing "zero fabricated data" rule
 *    forbids. See the `MIN_FIXTURES_FOR_REVIEW` gate below.
 *
 * HOW TO RUN
 * ----------
 *   npm run calibrate:ratings
 *
 * Requires `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
 * environment (read from `.env.local` automatically via Node's built-in
 * `--env-file`, wired through the npm script — see package.json). The
 * service-role key is required (not the anon key) because this needs to read
 * every player's lineup/event rows across the whole project, not just what
 * RLS would expose to a single authenticated user.
 *
 * HOW TO READ THE OUTPUT
 * -----------------------
 * This prints numbers; it does not print a verdict. A human should look at:
 *   - Does the distribution look like a football rating distribution (most
 *     players clustered near the 6.0 baseline, a real tail of standout/poor
 *     performances), or is something degenerate (everyone at exactly 6.0,
 *     or a bimodal split that suggests a data problem)?
 *   - Do the highest-rated performances in "Extremes" actually correspond to
 *     real hat-tricks / multi-goal games, and the lowest to real
 *     red-card/own-goal games? (Spot-check a handful by eye against what
 *     you know about those matches.)
 *   - Does the win/draw/loss sanity check show winning-team players rating
 *     higher on average than losing-team players? If it doesn't, something
 *     in the model or the data feeding it is wrong, not just "uncalibrated".
 * Once those look right on a real, meaningfully-sized sample, that is what
 * "calibrated" means for this engine — see docs/RATING_ENGINE.md's
 * "Calibration checklist" section, which this script's report maps onto
 * directly.
 */

import { createClient } from "@supabase/supabase-js";
import {
  computePlayerMatchRating,
  type PlayerMatchRatingInput,
  type PlayerMatchRating,
} from "../src/lib/football/rating-engine";
import type { Database } from "../src/lib/supabase/types";

// Node 20.12+/22 built-in — loads .env.local into process.env if present.
// Wrapped in try/catch since a CI environment may already have these set
// directly and have no .env.local file on disk at all.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local on disk — fine, assume the environment already has the
  // vars set (e.g. CI secrets).
}

/** Below this many real computed ratings, printing a distribution/extremes
 * report would imply there's enough real signal to judge the model by, when
 * there isn't. Deliberately generous compared to `MIN_RATING_SAMPLE = 3` in
 * rating-engine.ts (that constant gates one *player's* season average; this
 * one gates whether the whole *model* has been exposed to enough real
 * matches to say anything meaningful about it at all). */
const MIN_RATINGS_FOR_REPORT = 20;

type FixtureRow = {
  id: string;
  status: Database["public"]["Enums"]["fixture_status"];
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
};

type LineupRow = {
  fixture_id: string;
  team_id: string;
  player_id: string;
  is_starting: boolean;
  position: string | null;
};

type EventRow = {
  fixture_id: string;
  player_id: string | null;
  related_player_id: string | null;
  event_type: Database["public"]["Enums"]["fixture_event_type"];
};

type PlayerRow = { id: string; full_name: string; known_as: string | null };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    console.error("Set it in .env.local, or export it before running this script.");
    process.exit(1);
  }
  return value;
}

/** Real per-(player, fixture) event counts — same event_type → field mapping
 * `fantasy-scoring.ts`'s `computePlayerMatchFacts` already established
 * (goal/penalty_goal → scorer + related_player_id assist, own_goal,
 * yellow_card, red_card/second_yellow_card), just scoped per fixture instead
 * of aggregated across a gameweek's fixture set, since `rating-engine.ts`
 * rates one player in one match at a time. */
function buildEventCounts(events: EventRow[]) {
  type Counts = { goals: number; assists: number; ownGoals: number; yellowCards: number; redCards: number };
  const key = (fixtureId: string, playerId: string) => `${fixtureId}::${playerId}`;
  const counts = new Map<string, Counts>();
  const get = (fixtureId: string, playerId: string) => {
    const k = key(fixtureId, playerId);
    let c = counts.get(k);
    if (!c) {
      c = { goals: 0, assists: 0, ownGoals: 0, yellowCards: 0, redCards: 0 };
      counts.set(k, c);
    }
    return c;
  };

  for (const event of events) {
    if (event.event_type === "goal" || event.event_type === "penalty_goal") {
      if (event.player_id) get(event.fixture_id, event.player_id).goals += 1;
      if (event.related_player_id) get(event.fixture_id, event.related_player_id).assists += 1;
    } else if (event.event_type === "own_goal") {
      if (event.player_id) get(event.fixture_id, event.player_id).ownGoals += 1;
    } else if (event.event_type === "yellow_card") {
      if (event.player_id) get(event.fixture_id, event.player_id).yellowCards += 1;
    } else if (event.event_type === "red_card" || event.event_type === "second_yellow_card") {
      if (event.player_id) get(event.fixture_id, event.player_id).redCards += 1;
    }
    // penalty_missed, substitution, var_review: rating-engine.ts doesn't use these either.
  }
  return { key, counts };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

async function main() {
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  console.log("KIVO Rating Engine calibration report");
  console.log("======================================");
  console.log(`Run at: ${new Date().toISOString()}`);
  console.log(`Model version under review: rating-engine.ts's RATING_MODEL_VERSION`);
  console.log("");

  const { data: fixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, status, home_team_id, away_team_id, home_score, away_score")
    .eq("status", "finished")
    .returns<FixtureRow[]>();

  if (fixturesError) {
    console.error("Failed to query fixtures:", fixturesError.message);
    process.exit(1);
  }

  const finishedFixtures = fixtures ?? [];
  console.log(`Real finished fixtures in the live database: ${finishedFixtures.length}`);

  if (finishedFixtures.length === 0) {
    console.log("");
    console.log("NO REAL DATA TO CALIBRATE AGAINST.");
    console.log("");
    console.log(
      "There are zero finished fixtures in the live Supabase project right now. " +
        "This script is not going to invent fixtures, lineups, or events to produce a " +
        "report anyway — that would fabricate a data-driven model, which is exactly what " +
        "this tooling exists to prevent. Re-run this script once real matches have been " +
        "synced through to 'finished' status with lineups and events attached.",
    );
    console.log("");
    console.log("Calibration status: NOT DONE. The engine remains uncalibrated. Item 229 stays blocked on item 225.");
    process.exit(0);
  }

  const fixtureIds = finishedFixtures.map((f) => f.id);
  const fixtureById = new Map(finishedFixtures.map((f) => [f.id, f]));

  const [{ data: lineups, error: lineupsError }, { data: events, error: eventsError }] = await Promise.all([
    supabase
      .from("lineups")
      .select("fixture_id, team_id, player_id, is_starting, position")
      .in("fixture_id", fixtureIds)
      .returns<LineupRow[]>(),
    supabase
      .from("fixture_events")
      .select("fixture_id, player_id, related_player_id, event_type")
      .in("fixture_id", fixtureIds)
      .returns<EventRow[]>(),
  ]);

  if (lineupsError) {
    console.error("Failed to query lineups:", lineupsError.message);
    process.exit(1);
  }
  if (eventsError) {
    console.error("Failed to query fixture_events:", eventsError.message);
    process.exit(1);
  }

  const lineupRows = lineups ?? [];
  const eventRows = events ?? [];
  console.log(`Real lineup rows across those fixtures: ${lineupRows.length}`);
  console.log(`Real fixture_events rows across those fixtures: ${eventRows.length}`);
  console.log("");

  const { key: eventKey, counts: eventCounts } = buildEventCounts(eventRows);

  const playerIds = Array.from(new Set(lineupRows.map((l) => l.player_id)));
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, full_name, known_as")
    .in("id", playerIds.length > 0 ? playerIds : ["00000000-0000-0000-0000-000000000000"])
    .returns<PlayerRow[]>();

  if (playersError) {
    console.error("Failed to query players:", playersError.message);
    process.exit(1);
  }
  const playerNameById = new Map((players ?? []).map((p) => [p.id, p.known_as ?? p.full_name]));

  type Rated = { rating: PlayerMatchRating; input: PlayerMatchRatingInput; teamGoalsFor: number; teamGoalsAgainst: number };
  const rated: Rated[] = [];
  let evidenceOfInvolvementMissing = 0;

  for (const lineup of lineupRows) {
    const fixture = fixtureById.get(lineup.fixture_id);
    if (!fixture) continue;

    const teamGoalsFor = lineup.team_id === fixture.home_team_id ? fixture.home_score : fixture.away_score;
    const teamGoalsAgainst = lineup.team_id === fixture.home_team_id ? fixture.away_score : fixture.home_score;

    const counts = eventCounts.get(eventKey(lineup.fixture_id, lineup.player_id)) ?? {
      goals: 0,
      assists: 0,
      ownGoals: 0,
      yellowCards: 0,
      redCards: 0,
    };

    const input: PlayerMatchRatingInput = {
      playerId: lineup.player_id,
      fixtureId: lineup.fixture_id,
      fixtureStatus: fixture.status,
      position: lineup.position,
      isStarting: lineup.is_starting,
      goals: counts.goals,
      assists: counts.assists,
      ownGoals: counts.ownGoals,
      yellowCards: counts.yellowCards,
      redCards: counts.redCards,
      teamGoalsFor,
      teamGoalsAgainst,
    };

    const rating = computePlayerMatchRating(input);
    if (!rating) {
      evidenceOfInvolvementMissing += 1;
      continue;
    }
    rated.push({ rating, input, teamGoalsFor: teamGoalsFor ?? 0, teamGoalsAgainst: teamGoalsAgainst ?? 0 });
  }

  console.log(`Real player-match ratings computed: ${rated.length}`);
  console.log(
    `Lineup rows skipped (no real evidence of involvement — unused substitute, see rating-engine.ts): ${evidenceOfInvolvementMissing}`,
  );
  console.log("");

  if (rated.length < MIN_RATINGS_FOR_REPORT) {
    console.log(
      `Only ${rated.length} real ratings were computed, below this script's own review threshold of ` +
        `${MIN_RATINGS_FOR_REPORT}. That's too small a sample to draw any real conclusion about the model from — ` +
        "printing a full distribution/extremes report on this few data points would look more authoritative than " +
        "it is. Re-run once more real fixtures have finished with lineups + events synced.",
    );
    console.log("");
    console.log("Calibration status: NOT DONE (insufficient real sample). Item 229 stays blocked on item 225.");
    process.exit(0);
  }

  // ---- Distribution -----------------------------------------------------
  const ratingValues = rated.map((r) => r.rating.kivoRating);
  const avg = mean(ratingValues);
  console.log("Distribution");
  console.log("------------");
  console.log(`  n:       ${ratingValues.length}`);
  console.log(`  mean:    ${avg.toFixed(2)}`);
  console.log(`  median:  ${median(ratingValues).toFixed(2)}`);
  console.log(`  stddev:  ${stddev(ratingValues, avg).toFixed(2)}`);
  console.log(`  min:     ${Math.min(...ratingValues).toFixed(1)}`);
  console.log(`  max:     ${Math.max(...ratingValues).toFixed(1)}`);
  console.log("");

  const buckets = new Map<string, number>();
  for (let lo = 1; lo < 10; lo++) buckets.set(`${lo}.0-${lo + 1}.0`, 0);
  for (const v of ratingValues) {
    const lo = Math.max(1, Math.min(9, Math.floor(v)));
    const bucketKey = `${lo}.0-${lo + 1}.0`;
    buckets.set(bucketKey, (buckets.get(bucketKey) ?? 0) + 1);
  }
  console.log("  Histogram:");
  for (const [range, count] of buckets) {
    const bar = "#".repeat(Math.round((count / ratingValues.length) * 50));
    console.log(`    ${range.padEnd(9)} ${String(count).padStart(5)}  ${bar}`);
  }
  console.log("");

  // ---- By position group --------------------------------------------------
  console.log("Mean rating by position group");
  console.log("------------------------------");
  const byGroup = new Map<string, number[]>();
  for (const r of rated) {
    const list = byGroup.get(r.rating.positionGroup) ?? [];
    list.push(r.rating.kivoRating);
    byGroup.set(r.rating.positionGroup, list);
  }
  for (const [group, values] of byGroup) {
    console.log(`  ${group.padEnd(14)} n=${String(values.length).padStart(4)}  mean=${mean(values).toFixed(2)}`);
  }
  console.log("");

  // ---- Extremes (for human spot-checking) ---------------------------------
  const sorted = [...rated].sort((a, b) => b.rating.kivoRating - a.rating.kivoRating);
  const describe = (r: Rated) => {
    const name = playerNameById.get(r.input.playerId) ?? r.input.playerId;
    const parts = [`${r.input.goals}g`, `${r.input.assists}a`];
    if (r.input.ownGoals) parts.push(`${r.input.ownGoals}og`);
    if (r.input.yellowCards) parts.push(`${r.input.yellowCards}yc`);
    if (r.input.redCards) parts.push(`${r.input.redCards}rc`);
    parts.push(`team ${r.teamGoalsFor}-${r.teamGoalsAgainst}`);
    return `${r.rating.kivoRating.toFixed(1)}  ${name} (${r.rating.positionGroup}, fixture ${r.input.fixtureId}) — ${parts.join(", ")}`;
  };

  console.log("Highest-rated real performances (spot-check these against what actually happened)");
  console.log("------------------------------------------------------------------------------------");
  for (const r of sorted.slice(0, 10)) console.log(`  ${describe(r)}`);
  console.log("");

  console.log("Lowest-rated real performances (spot-check these too)");
  console.log("-------------------------------------------------------");
  for (const r of sorted.slice(-10).reverse()) console.log(`  ${describe(r)}`);
  console.log("");

  // ---- Sanity check: did higher-rated players' teams tend to win more? ---
  // Real, computed check — not a guess: for every rated player, resolve
  // their team's real result in that real fixture (win/draw/loss from the
  // fixture's own home_score/away_score, the same fields the engine itself
  // used to compute teamGoalsFor/teamGoalsAgainst), then compare mean
  // kivoRating across the three real outcome buckets.
  console.log("Sanity check: mean rating by the player's team's real match result");
  console.log("----------------------------------------------------------------------");
  const byResult = { win: [] as number[], draw: [] as number[], loss: [] as number[] };
  for (const r of rated) {
    if (r.teamGoalsFor > r.teamGoalsAgainst) byResult.win.push(r.rating.kivoRating);
    else if (r.teamGoalsFor < r.teamGoalsAgainst) byResult.loss.push(r.rating.kivoRating);
    else byResult.draw.push(r.rating.kivoRating);
  }
  for (const [result, values] of Object.entries(byResult)) {
    if (values.length === 0) {
      console.log(`  ${result.padEnd(6)} n=0`);
      continue;
    }
    console.log(`  ${result.padEnd(6)} n=${String(values.length).padStart(4)}  mean=${mean(values).toFixed(2)}`);
  }
  const winMean = byResult.win.length > 0 ? mean(byResult.win) : null;
  const lossMean = byResult.loss.length > 0 ? mean(byResult.loss) : null;
  console.log("");
  if (winMean !== null && lossMean !== null) {
    const passed = winMean > lossMean;
    console.log(
      `  ${passed ? "PASS" : "FAIL"}: mean rating for players on winning teams (${winMean.toFixed(2)}) is ` +
        `${passed ? "higher than" : "NOT higher than"} for players on losing teams (${lossMean.toFixed(2)}).`,
    );
    if (!passed) {
      console.log("  This is the headline sanity check the model should pass before anyone trusts it on a real screen.");
      console.log("  If it fails on a real, meaningfully-sized sample, investigate before considering calibration done.");
    }
  } else {
    console.log("  Not enough real wins/losses in this sample to run the win-vs-loss comparison yet.");
  }
  console.log("");

  console.log(
    "Calibration status: REPORT PRINTED — this is data for a human to review, not a verdict. " +
      "Nothing above modified RATING_WEIGHTS. See docs/RATING_ENGINE.md's calibration checklist " +
      "for what to look for before deciding this model is ready to wire into a UI (item 229).",
  );
}

main().catch((error) => {
  console.error("Calibration script failed:", error);
  process.exit(1);
});
