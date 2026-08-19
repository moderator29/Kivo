"use server";

import { revalidatePath } from "next/cache";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { awardBadge, awardXp, evaluateBadgeCriteria } from "@/lib/rewards";
import { logAudit } from "@/lib/audit";
import {
  PREDICTION_TYPE_LABEL,
  computeStreaks,
  motmVoteFromOptions,
  pickFromRow,
  predictionXp,
  resolvePrediction,
  type FixtureFactEvent,
  type FixtureFacts,
  type PredictionType,
} from "@/lib/predictions";
import { logError } from "@/lib/log";

/**
 * On-demand admin pass, same shape as the football syncs on this page: no
 * cron, an admin triggers it, it processes what's real and reports what it
 * did. Scores every not-yet-settled prediction against real, already-synced
 * data (never a guessed or fabricated result), writes `points_awarded`,
 * `resolution` and `locked_at`, and awards XP for correct picks via the
 * shared ledger helper. Runs under the service-role client because it writes
 * points onto other users' rows, which `predictions_update_own_unlocked`
 * (correctly) never allows a plain client to do.
 *
 * MIGRATION 0079 CHANGED WHAT "SCORED" MEANS, and it is worth being explicit
 * about because it is the whole point of the six-type build.
 *
 * A winner or correct-score prediction only needs the final score, which a
 * finished fixture always has. The other types need data that is synced
 * separately and may simply be missing: match events (first scorer), team
 * statistics (cards & corners), or the Room's own vote (man of the match).
 * When that data is not there, this pass writes `resolution = 'unresolvable'`
 * with a reason a person can read, leaves `points_awarded` NULL — so the row
 * stays out of every leaderboard sum and costs the user nothing — and
 * re-examines it on the next run, because a detail sync landing next week
 * settles it for real.
 *
 * The one thing it must never do is call a prediction wrong because KIVO
 * never checked.
 */

type ServiceClient = ReturnType<typeof createServiceRoleSupabaseClient>;

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

export async function scorePredictions(): Promise<{
  error: string | null;
  recordsProcessed?: number;
  /** Rows this pass genuinely could not settle, and why — surfaced to the
   * admin rather than hidden, because "nothing happened" and "forty rows are
   * waiting on a details sync" look identical from a count alone. */
  unresolvedCount?: number;
}> {
  const profile = await getOrCreateProfile();
  if (!profile || !canManageFootballData(profile.role)) {
    return { error: "You don't have football data admin access." };
  }

  const supabase = createServerSupabaseClient();
  const { data: finishedFixtures, error: fixturesError } = await supabase
    .from("fixtures")
    .select("id, home_score, away_score")
    .eq("status", "finished")
    .not("home_score", "is", null)
    .not("away_score", "is", null);

  if (fixturesError) {
    logError("admin.data-health.predictions-actions.loadFinishedFixturesScoring", fixturesError);
    return { error: "Couldn't load finished fixtures. Try again." };
  }

  const scoredFixtures = (finishedFixtures ?? []).map((fixture) => ({
    id: fixture.id,
    home_score: fixture.home_score as number,
    away_score: fixture.away_score as number,
  }));
  if (scoredFixtures.length === 0) {
    return { error: null, recordsProcessed: 0, unresolvedCount: 0 };
  }

  const fixtureIds = scoredFixtures.map((fixture) => fixture.id);

  const service = createServiceRoleSupabaseClient();
  const { data: unscored, error: predictionsError } = await service
    .from("predictions")
    .select(
      `id, profile_id, fixture_id, prediction_type, predicted_outcome, predicted_home_score,
       predicted_away_score, predicted_player_id, predicted_total_goals, predicted_cards, predicted_corners`,
    )
    .in("fixture_id", fixtureIds)
    .is("points_awarded", null);

  if (predictionsError) {
    logError("admin.data-health.predictions-actions.loadUnscoredPredictions", predictionsError);
    return { error: "Couldn't load predictions to score. Try again." };
  }

  const rows = unscored ?? [];
  if (rows.length === 0) {
    return { error: null, recordsProcessed: 0, unresolvedCount: 0 };
  }

  // Only load facts for the fixtures that actually have something waiting.
  const pendingFixtureIds = new Set(rows.map((row) => row.fixture_id));
  const facts = await loadFixtureFacts(
    service,
    scoredFixtures.filter((fixture) => pendingFixtureIds.has(fixture.id)),
  );

  const now = new Date().toISOString();
  let processed = 0;
  let unresolved = 0;

  for (const row of rows) {
    const fixtureFacts = facts.get(row.fixture_id);
    if (!fixtureFacts) continue;

    const verdict = resolvePrediction(pickFromRow(row), fixtureFacts);

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
      logError("admin.data-health.predictions-actions.scorePrediction", updateError, {
        detail: `Failed to score prediction ${row.id}`,
      });
      continue;
    }

    if (verdict.resolution === "unresolvable") {
      // Deliberately not counted as processed: nothing was settled. Counting
      // it would let this pass report "40 scored" for forty rows it declined
      // to score, which is precisely the kind of comfortable number this
      // product refuses to print.
      unresolved += 1;
      continue;
    }

    processed += 1;
    if (verdict.resolution === "correct") {
      await awardCorrectPrediction(service, row.id, row.profile_id, row.prediction_type);
    }
  }

  await logAudit(profile.id, "score_predictions", "predictions", {
    fixturesConsidered: scoredFixtures.length,
    recordsProcessed: processed,
    unresolvedCount: unresolved,
  });

  revalidatePath("/predictions");
  revalidatePath("/admin/data-health");

  return { error: null, recordsProcessed: processed, unresolvedCount: unresolved };
}

/**
 * XP and badges for one genuinely correct prediction, unchanged in shape from
 * the winner-only version — the only difference is that XP now scales with
 * the type's own difficulty, at exactly the ratio the winner type always
 * used, so a winner pick still awards the same 15 XP it always did.
 */
async function awardCorrectPrediction(
  service: ServiceClient,
  predictionId: string,
  profileId: string,
  type: PredictionType,
): Promise<void> {
  // KN-91: keyed on the prediction, so re-running this scoring pass — which
  // an admin can do at any time, and which a partial failure invites —
  // cannot credit the same correct prediction twice.
  await awardXp(profileId, predictionXp(type), `Correct ${PREDICTION_TYPE_LABEL[type].toLowerCase()} prediction`, `prediction:${predictionId}`);
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
