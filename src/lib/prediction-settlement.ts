import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { awardBadge, evaluateBadgeCriteria, reconcileXp } from "@/lib/rewards";
import { predictionXpReason } from "@/lib/xp-policy";
import {
  PREDICTION_TYPE_LABEL,
  computeStreaks,
  motmVoteFromOptions,
  pickFromRow,
  predictionXp,
  resolvePrediction,
  type FixtureFactEvent,
  type FixtureFacts,
} from "@/lib/predictions";
import { logError } from "@/lib/log";

/**
 * Settling predictions, as a function anything can call.
 *
 * ## Why this stopped being a Server Action and became a module
 *
 * This engine lived inside `admin/football/predictions-actions.ts`, which is
 * a `"use server"` file — so the only way to reach it was for a signed-in
 * football-data admin to open a page and press a button. On a deployed product
 * that means a fan makes a correct call, the match finishes, and **nothing
 * ever settles it.** Six prediction types, XP, badges, streaks and a
 * leaderboard, all inert until a human remembers. That is a broken feature
 * rather than an operational note, which is why it moved here: a Server Action
 * may only export async functions and carries a session, and a scheduled job
 * has neither a session nor a person.
 *
 * The admin button still exists and still calls this. It is now one caller of
 * two, not the only door.
 *
 * ## What it costs against the provider: nothing, ever
 *
 * Every input is a row KIVO already holds — `fixtures` for the score,
 * `fixture_events` for goals and cards, `fixture_statistics` for corners, and
 * the Room's own MOTM poll. No provider client is constructed on any path
 * through this file, so it must never be gated behind a quota check, a budget
 * reservation, or `FOOTBALL_LIVE_POLLING_ENABLED`. That is not an optimisation;
 * it is what lets the scheduler run it on a deployment where no football key is
 * configured at all, which is exactly the state where predictions would
 * otherwise sit unsettled forever.
 *
 * ## What "settled" means here
 *
 * A winner or correct-score prediction only needs the final score, which a
 * finished fixture always has. The other types need data that is synced
 * separately and may simply be missing: match events (first scorer), team
 * statistics (cards & corners), or the Room's own vote (man of the match).
 * When that data is not there, this writes `resolution = 'unresolvable'` with a
 * reason a person can read, leaves `points_awarded` NULL — so the row stays out
 * of every leaderboard sum and costs the user nothing — and re-examines it on
 * the next run, because a detail sync landing next week settles it for real.
 *
 * The one thing it must never do is call a prediction wrong because KIVO never
 * checked.
 *
 * ## Safe to run on a schedule
 *
 * Three properties make a repeating job safe here, and all three are load-bearing:
 *
 *   - **Nothing is written where the verdict is unchanged**, which is the
 *     overwhelmingly common case on any run after the first.
 *   - **XP goes through `reconcileXp`, never `awardXp`.** Reconciliation writes
 *     the delta between what a source has already paid out and what it should
 *     now pay out, so running twice with nothing changed writes nothing, and a
 *     verdict that moves from correct to incorrect takes the XP back instead of
 *     leaving it stranded. A daily job that awards twice would be worse than
 *     one that never runs.
 *   - **The work is bounded per invocation** (`SETTLEMENT_BATCH_SIZE`), oldest
 *     examination first, so a long backlog drains over several runs rather than
 *     turning one cron firing into a job that outlives its own window.
 */

type ServiceClient = SupabaseClient<Database>;

/**
 * How many predictions one invocation will examine.
 *
 * This is database work, not provider work, but it is not free: each row can
 * cost a reconciliation write and, when it newly becomes correct, a badge
 * sweep. Bounded so a backlog cannot turn a scheduled call into a long-running
 * job. Whatever is not reached is picked up on the next run, because the
 * ordering below is oldest-examined-first and therefore rotates fairly rather
 * than starving the same tail every time.
 */
export const SETTLEMENT_BATCH_SIZE = 500;

export type SettlementResult = {
  /** Predictions that genuinely reached a correct/incorrect verdict this run. */
  settled: number;
  /** Rows KIVO declined to settle because the data they need was never synced.
   * Counted separately and never folded into `settled` — reporting forty rows
   * as scored when forty rows were refused is exactly the comfortable number
   * this product does not print. */
  unresolved: number;
  /** Rows that had already been settled and now say something different — a
   * corrected score, a detail sync that landed, a fixed scoring bug. XP is
   * reconciled for each, so this is also "how many people's totals moved". */
  adjusted: number;
  /** Distinct finished fixtures this run actually looked at. */
  fixturesConsidered: number;
};

export const EMPTY_SETTLEMENT: SettlementResult = {
  settled: 0,
  unresolved: 0,
  adjusted: 0,
  fixturesConsidered: 0,
};

/** Yellow + red, per team, from the provider's own statistics row. Null for
 * either figure means "not reported", never zero. */
function teamCardTotal(row: { yellow_cards: number | null; red_cards: number | null }): number | null {
  if (row.yellow_cards === null && row.red_cards === null) return null;
  return (row.yellow_cards ?? 0) + (row.red_cards ?? 0);
}

/**
 * Reads every fact the six resolvers can need, for a batch of fixtures, in
 * five queries rather than five per fixture.
 *
 * `null` in the returned facts always means "KIVO has not synced this",
 * distinct from an empty array meaning "KIVO synced it and there was
 * nothing". `resolvePrediction` depends on that distinction absolutely.
 */
async function loadFixtureFacts(
  service: ServiceClient,
  fixtures: { id: string; home_score: number; away_score: number }[],
): Promise<Map<string, FixtureFacts>> {
  const fixtureIds = fixtures.map((fixture) => fixture.id);

  const [{ data: events }, { data: statistics }, { data: motmPosts }] = await Promise.all([
    service
      .from("fixture_events")
      .select("fixture_id, event_type, minute, added_time, player_id")
      .in("fixture_id", fixtureIds),
    service
      .from("fixture_statistics")
      .select("fixture_id, team_id, yellow_cards, red_cards, corners")
      .in("fixture_id", fixtureIds),
    service.from("posts").select("id, fixture_id").in("fixture_id", fixtureIds).eq("poll_kind", "motm"),
  ]);

  const eventsByFixture = new Map<string, FixtureFactEvent[]>();
  for (const event of events ?? []) {
    const list = eventsByFixture.get(event.fixture_id) ?? [];
    list.push({
      eventType: event.event_type,
      minute: event.minute,
      addedTime: event.added_time,
      playerId: event.player_id,
    });
    eventsByFixture.set(event.fixture_id, list);
  }

  const statsByFixture = new Map<string, { totalCards: number | null; totalCorners: number | null }>();
  const statRowsByFixture = new Map<string, typeof statistics>();
  for (const row of statistics ?? []) {
    const list = statRowsByFixture.get(row.fixture_id) ?? [];
    list!.push(row);
    statRowsByFixture.set(row.fixture_id, list);
  }
  for (const [fixtureId, rows] of statRowsByFixture) {
    // A match has two sides. One side's statistics row is not a match total,
    // and adding it up as though it were would be a fabricated number.
    if (!rows || rows.length < 2) continue;
    const cardTotals = rows.map(teamCardTotal);
    const cornerTotals = rows.map((row) => row.corners);
    statsByFixture.set(fixtureId, {
      totalCards: cardTotals.some((value) => value === null)
        ? null
        : cardTotals.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      totalCorners: cornerTotals.some((value) => value === null)
        ? null
        : cornerTotals.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    });
  }

  // The Room's man-of-the-match vote. KIVO has no provider MOTM award, so
  // this is the only real answer there is — and it is only usable because
  // migration 0078 links a poll option to a real players.id.
  const motmByFixture = new Map<string, FixtureFacts["motm"]>();
  const motmPostIds = (motmPosts ?? []).map((post) => post.id);
  if (motmPostIds.length > 0) {
    const [{ data: options }, { data: votes }] = await Promise.all([
      service.from("poll_options").select("id, post_id, player_id").in("post_id", motmPostIds),
      service.from("poll_votes").select("post_id, option_id").in("post_id", motmPostIds),
    ]);

    const votesByOption = new Map<string, number>();
    for (const vote of votes ?? []) {
      votesByOption.set(vote.option_id, (votesByOption.get(vote.option_id) ?? 0) + 1);
    }

    const optionsByPost = new Map<string, { player_id: string | null; vote_count: number }[]>();
    for (const option of options ?? []) {
      const list = optionsByPost.get(option.post_id) ?? [];
      list.push({ player_id: option.player_id, vote_count: votesByOption.get(option.id) ?? 0 });
      optionsByPost.set(option.post_id, list);
    }

    for (const post of motmPosts ?? []) {
      if (!post.fixture_id) continue;
      motmByFixture.set(post.fixture_id, motmVoteFromOptions(optionsByPost.get(post.id) ?? []));
    }
  }

  const facts = new Map<string, FixtureFacts>();
  for (const fixture of fixtures) {
    facts.set(fixture.id, {
      homeScore: fixture.home_score,
      awayScore: fixture.away_score,
      events: eventsByFixture.get(fixture.id) ?? null,
      statistics: statsByFixture.get(fixture.id) ?? null,
      motm: motmByFixture.get(fixture.id) ?? null,
    });
  }
  return facts;
}

/**
 * Settles what it can, reports what it could not, and touches no provider.
 *
 * The read is driven from `predictions` rather than from `fixtures`, and that
 * inversion matters now that this runs on a schedule. Starting from "every
 * finished fixture" is an unbounded scan that grows with the season whether or
 * not anybody predicted any of it; starting from "predictions whose fixture has
 * finished" is bounded by real user activity, which is the only thing there is
 * actually work for. `!inner` makes the join a filter rather than a fetch, so a
 * prediction on a fixture that has not finished is never returned at all.
 */
export async function settlePredictions(service: ServiceClient): Promise<SettlementResult> {
  // Every prediction on a finished fixture, not only the unsettled ones.
  //
  // This used to filter `points_awarded is null`, which made the pass strictly
  // one-directional: once a row was settled it was never looked at again. That
  // is wrong in three real situations, and all three now exist. An unresolvable
  // row settles for real once its detail sync lands. An audited admin data
  // correction can change a final score after predictions were scored against
  // the old one. And a fixed scoring bug has to be able to re-run.
  //
  // Ordered oldest-examination-first with never-examined rows ahead of
  // everything (`resolved_at` is null until this pass has looked once), so a
  // scheduled run always does the newly-available work before re-checking
  // settled history, and the batch cap rotates rather than starves.
  const { data: allPredictions, error: predictionsError } = await service
    .from("predictions")
    .select(
      `id, profile_id, fixture_id, prediction_type, predicted_outcome, predicted_home_score,
       predicted_away_score, predicted_player_id, predicted_total_goals, predicted_cards,
       predicted_corners, points_awarded, resolution, resolved_at,
       fixture:fixtures!inner(id, home_score, away_score, status)`,
    )
    .eq("fixture.status", "finished")
    .not("fixture.home_score", "is", null)
    .not("fixture.away_score", "is", null)
    .order("resolved_at", { ascending: true, nullsFirst: true })
    .limit(SETTLEMENT_BATCH_SIZE);

  if (predictionsError) {
    logError("prediction-settlement.loadPredictions", predictionsError);
    throw predictionsError;
  }

  const rows = allPredictions ?? [];
  if (rows.length === 0) return { ...EMPTY_SETTLEMENT };

  // One entry per distinct fixture the batch actually touches — the facts
  // loader is batched, so this is what keeps it to five queries regardless of
  // how many predictions share a match.
  const fixturesById = new Map<string, { id: string; home_score: number; away_score: number }>();
  for (const row of rows) {
    if (!row.fixture || fixturesById.has(row.fixture.id)) continue;
    fixturesById.set(row.fixture.id, {
      id: row.fixture.id,
      home_score: row.fixture.home_score as number,
      away_score: row.fixture.away_score as number,
    });
  }

  const facts = await loadFixtureFacts(service, Array.from(fixturesById.values()));

  const now = new Date().toISOString();
  let settled = 0;
  let unresolved = 0;
  let adjusted = 0;

  for (const row of rows) {
    const fixtureFacts = facts.get(row.fixture_id);
    if (!fixtureFacts) continue;

    const verdict = resolvePrediction(pickFromRow(row), fixtureFacts);
    const verdictUnchanged = row.resolution === verdict.resolution && row.points_awarded === verdict.points;

    if (!verdictUnchanged) {
      const { error: updateError } = await service
        .from("predictions")
        .update({
          points_awarded: verdict.points,
          resolution: verdict.resolution,
          unresolvable_reason: verdict.reason,
          resolved_at: now,
          // Locked either way: the match has finished, so the pick is final
          // whether or not KIVO can settle it yet.
          locked_at: now,
        })
        .eq("id", row.id);

      if (updateError) {
        logError("prediction-settlement.updatePrediction", updateError, {
          detail: `Failed to settle prediction ${row.id}`,
        });
        continue;
      }

      // A row that had already been settled and now says something different
      // is the case worth counting separately: it means real, previously
      // reported numbers moved, and whoever is reading this run's output should
      // know that happened rather than reading it as a routine pass.
      if (row.resolution !== null) adjusted += 1;
    } else if (row.resolved_at === null) {
      // Nothing to write, but this row has now genuinely been examined. Without
      // stamping it, an already-correct verdict on a never-examined row would
      // sort first forever and the batch would re-read the same head of the
      // queue on every run.
      await service.from("predictions").update({ resolved_at: now }).eq("id", row.id);
    }

    // Reconciled every run, changed or not. This is the only thing that can
    // take XP back off a prediction whose verdict moved — including the case
    // that used to be silently impossible: a correct prediction re-scored
    // against a corrected final score, which previously kept its XP forever.
    // A no-change run writes nothing, because the delta is zero.
    const { changed } = await reconcileXp(
      row.profile_id,
      `prediction:${row.id}`,
      verdict.resolution === "correct" ? predictionXp(row.prediction_type) : 0,
      verdict.resolution === "correct"
        ? predictionXpReason(PREDICTION_TYPE_LABEL[row.prediction_type])
        : `Prediction re-scored · ${PREDICTION_TYPE_LABEL[row.prediction_type]}`,
    );

    if (verdict.resolution === "unresolvable") {
      unresolved += 1;
      continue;
    }

    settled += 1;
    // Badges only when this row genuinely became correct in this run. Running
    // the badge sweep for every already-correct prediction on every pass would
    // re-evaluate the whole catalogue for every user, every time, to award
    // nothing.
    if (verdict.resolution === "correct" && (changed || !verdictUnchanged)) {
      await awardPredictionBadges(service, row.profile_id);
    }
  }

  return { settled, unresolved, adjusted, fixturesConsidered: fixturesById.size };
}

/**
 * The scheduled caller's wrapper: never throws, never fails its caller.
 *
 * `handleScheduledSync` runs this alongside a football sync whose success must
 * not depend on it. A settlement failure is logged and reported as zeros, the
 * same best-effort contract the rate-limit prune and the live fantasy scoring
 * already hold in that route.
 */
export async function settlePredictionsBestEffort(service: ServiceClient): Promise<SettlementResult> {
  try {
    return await settlePredictions(service);
  } catch (error) {
    logError("prediction-settlement.scheduled", error);
    return { ...EMPTY_SETTLEMENT };
  }
}

/**
 * Badges for one genuinely correct prediction.
 *
 * XP is no longer awarded here — `reconcileXp` in the loop above owns it, so
 * that the same code path handles the award, the re-award and the take-back.
 * Splitting them was the point: an award function can only ever add.
 */
async function awardPredictionBadges(service: ServiceClient, profileId: string): Promise<void> {
  await awardBadge(profileId, "first_prediction_correct");
  // KIVO_NEXT_GEN KN-92: the criteria-driven half of the catalogue, evaluated
  // off the same real scoring event.
  await evaluateBadgeCriteria(profileId);

  // Real running total, not a guessed streak — counts this user's
  // actually-scored correct predictions straight from the predictions table
  // (points_awarded is only ever set by this same scoring pass).
  const { count: correctCount } = await service
    .from("predictions")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .gt("points_awarded", 0);
  if ((correctCount ?? 0) >= 5) {
    await awardBadge(profileId, "five_predictions_correct");
  }

  // RECOMMENDATIONS item 169: a real streak, computed the same way
  // /predictions/mine displays one (computeStreaks, ordered by fixture
  // kickoff_at) — awarded the moment this user's own scored history genuinely
  // reaches a 3-run, never guessed or assumed from this single row alone.
  //
  // Unresolvable rows are excluded by `points_awarded is not null`, which is
  // the correct reading: a prediction KIVO could not settle is not a miss, so
  // it must not break a streak either.
  const { data: scoredHistory } = await service
    .from("predictions")
    .select("points_awarded, fixture:fixtures(kickoff_at)")
    .eq("profile_id", profileId)
    .not("points_awarded", "is", null);
  const streaks = computeStreaks(
    (scoredHistory ?? [])
      .filter((prediction) => prediction.fixture !== null)
      .map((prediction) => ({
        pointsAwarded: prediction.points_awarded ?? 0,
        kickoffAt: prediction.fixture!.kickoff_at,
      })),
  );
  if (streaks.current >= 3) {
    await awardBadge(profileId, "three_prediction_streak");
  }
}