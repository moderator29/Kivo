/**
 * Drives the real fantasy scorer against the local verification database and
 * checks the claims the product makes about its own output — most importantly
 * the reconciliation identity the gameweek scorecard renders:
 *
 *     sum(per-player total_points) + transfer cost === the stored total
 *
 * Nothing here re-implements scoring. It calls `runGameweekScoring`, the same
 * function the admin action calls, and then interrogates what landed in the
 * database.
 */
import { runGameweekScoring } from "@/lib/fantasy-gameweek-scoring";
import { rescoreLiveGameweeks } from "@/lib/fantasy-live-scoring";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { assessTransfers, FREE_TRANSFERS_PER_GAMEWEEK, TRANSFER_HIT_POINTS } from "@/app/(app)/fantasy/fantasy-rules";
import { cookieReaders } from "./next-headers-stub";

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const supabase = createServiceRoleSupabaseClient();

async function gameweek(number: number) {
  const { data } = await supabase
    .from("fantasy_gameweeks")
    .select("id, number, deadline_at, is_current, season_id")
    .eq("number", number)
    .maybeSingle();
  if (!data) throw new Error(`No gameweek ${number}`);
  return data;
}

async function scorecardFacts(gameweekId: string) {
  const { data: totals } = await supabase
    .from("fantasy_points")
    .select("fantasy_team_id, points, status, transfer_points_cost, fixtures_total, fixtures_finished, fixtures_with_events, scoring_model_version")
    .eq("gameweek_id", gameweekId);
  const { data: breakdowns } = await supabase
    .from("fantasy_point_breakdowns")
    .select("fantasy_team_id, player_id, is_starting, multiplier, total_points, goals, assists, clean_sheets, appearance_points, goal_points, assist_points, clean_sheet_points, card_points, scoring_model_version")
    .eq("gameweek_id", gameweekId);
  return { totals: totals ?? [], breakdowns: breakdowns ?? [] };
}

async function main() {
  // ---------------------------------------------------------------- gameweek 3
  const gw3 = await gameweek(3);
  const run3 = await runGameweekScoring(gw3.id);
  console.log("\n[gameweek 3]", JSON.stringify(run3));
  check("GW3 scores without error", run3.error === null, run3.error ?? "");
  // Every GW3 fixture has finished, but one of them is a goalless draw and so
  // carries no events. The scorer treats that as indistinguishable from a
  // fixture whose events never synced and refuses to call the gameweek settled
  // — which is the documented intent, not an accident.
  check(
    "GW3 stays provisional because one finished fixture has no events at all",
    run3.status === "provisional" && run3.fixturesFinished === run3.fixturesTotal &&
      (run3.fixturesWithEvents ?? 0) < (run3.fixturesFinished ?? 0),
    `status=${run3.status} finished=${run3.fixturesFinished}/${run3.fixturesTotal} withEvents=${run3.fixturesWithEvents}`,
  );

  const gw3Facts = await scorecardFacts(gw3.id);
  check(
    "GW3 stores the counts that explain why it is provisional",
    gw3Facts.totals.every(
      (t) => t.fixtures_total === run3.fixturesTotal && t.fixtures_finished === run3.fixturesFinished &&
        t.fixtures_with_events === run3.fixturesWithEvents,
    ),
    gw3Facts.totals.map((t) => `${t.fixtures_with_events}/${t.fixtures_finished} of ${t.fixtures_total}`).join(" "),
  );
  check("GW3 wrote a total per squad", gw3Facts.totals.length === 2, `${gw3Facts.totals.length} rows`);

  for (const total of gw3Facts.totals) {
    const mine = gw3Facts.breakdowns.filter((b) => b.fantasy_team_id === total.fantasy_team_id);
    const summed = mine.reduce((acc, b) => acc + b.total_points, 0);
    check(
      `GW3 reconciles for ${total.fantasy_team_id.slice(0, 8)}`,
      summed + total.transfer_points_cost === total.points,
      `sum(${summed}) + transfers(${total.transfer_points_cost}) === stored(${total.points})`,
    );
    check(
      `GW3 breakdown covers the whole squad for ${total.fantasy_team_id.slice(0, 8)}`,
      mine.length === 15,
      `${mine.length} player rows`,
    );
    const captain = mine.filter((b) => b.multiplier === 2);
    check(
      `GW3 has exactly one doubled player for ${total.fantasy_team_id.slice(0, 8)}`,
      captain.length === 1,
      `${captain.length} with multiplier 2`,
    );
    check(
      `GW3 bench scores nothing for ${total.fantasy_team_id.slice(0, 8)}`,
      mine.filter((b) => !b.is_starting).every((b) => b.total_points === 0),
      `bench rows: ${mine.filter((b) => !b.is_starting).map((b) => b.total_points).join(",")}`,
    );
    check(
      `GW3 records the ruleset version for ${total.fantasy_team_id.slice(0, 8)}`,
      total.scoring_model_version === "1.0" && mine.every((b) => b.scoring_model_version === "1.0"),
      `total=${total.scoring_model_version}`,
    );
  }

  // Component arithmetic, on the row with the most going on.
  const busiest = [...gw3Facts.breakdowns].sort((a, b) => b.total_points - a.total_points)[0];
  if (busiest) {
    const components =
      busiest.appearance_points + busiest.goal_points + busiest.assist_points + busiest.clean_sheet_points + busiest.card_points;
    check(
      "GW3 top scorer's components sum to their total after the multiplier",
      components * busiest.multiplier === busiest.total_points,
      `(${components}) x ${busiest.multiplier} === ${busiest.total_points}`,
    );
  }

  // ---------------------------------------------------------------- gameweek 4
  // Rewind matchday 4 to the middle of the afternoon: two matches in play, and
  // the goals scored after the hour mark not yet in the database, because they
  // have not happened yet. This is the state a manager actually refreshes into.
  const gw4 = await gameweek(4);
  const { data: matchday4 } = await supabase
    .from("fixtures").select("id, home_score, away_score, kickoff_at, status")
    .eq("matchday", 4).order("kickoff_at", { ascending: true });
  const inPlay = (matchday4 ?? []).slice(0, 2);

  const withheld: Record<string, unknown>[] = [];
  for (const [index, fixture] of inPlay.entries()) {
    const minute = index === 0 ? 67 : 45;
    // Events later than the clock have not happened yet. Withholding them is
    // the whole point: a provisional total that already contains every goal of
    // the match is not provisional in any way a manager would recognise.
    const { data: notYet } = await supabase
      .from("fixture_events")
      .select("id, fixture_id, player_id, related_player_id, team_id, event_type, minute, detail")
      .eq("fixture_id", fixture.id)
      .gt("minute", minute);
    withheld.push(...((notYet ?? []) as Record<string, unknown>[]));
    if ((notYet ?? []).length) {
      await supabase.from("fixture_events").delete().in("id", (notYet ?? []).map((e) => e.id));
    }

    const { data: soFar } = await supabase
      .from("fixture_events")
      .select("team_id, event_type")
      .eq("fixture_id", fixture.id);
    const goalsFor = (teamId: string) =>
      (soFar ?? []).filter((e) => e.team_id === teamId && (e.event_type === "goal" || e.event_type === "penalty_goal")).length;
    const { data: teams } = await supabase
      .from("fixtures").select("home_team_id, away_team_id").eq("id", fixture.id).maybeSingle();

    await supabase
      .from("fixtures")
      .update({
        status: index === 0 ? "live" : "halftime",
        minute_elapsed: minute,
        home_score: goalsFor(teams!.home_team_id),
        away_score: goalsFor(teams!.away_team_id),
      })
      .eq("id", fixture.id);
    console.log(
      `[live] ${fixture.id.slice(0, 8)} rewound to ${minute}' at ${goalsFor(teams!.home_team_id)}-${goalsFor(teams!.away_team_id)}, ` +
        `${(notYet ?? []).length} later events withheld`,
    );
  }

  const run4 = await runGameweekScoring(gw4.id);
  console.log("\n[gameweek 4, mid-afternoon]", JSON.stringify({ ...run4, repricedPlayerIds: undefined }));
  check("GW4 scores without error", run4.error === null, run4.error ?? "");
  check(
    "GW4 is provisional while two of its matches are still being played",
    run4.status === "provisional",
    `status=${run4.status} finished=${run4.fixturesFinished}/${run4.fixturesTotal}`,
  );

  const gw4Before = await scorecardFacts(gw4.id);
  const provisionalTotals = new Map(gw4Before.totals.map((t) => [t.fantasy_team_id, t.points]));
  check(
    "GW4 totals are stored as provisional",
    gw4Before.totals.every((t) => t.status === "provisional"),
    gw4Before.totals.map((t) => `${t.points}(${t.status})`).join(" "),
  );

  // --------------------------------------- full time, and the rest of the goals
  console.log(`\n[live] full time on ${inPlay.length} fixtures, ${withheld.length} late events arriving`);
  if (withheld.length) {
    await supabase.from("fixture_events").insert(withheld as never);
  }
  for (const fixture of inPlay) {
    await supabase
      .from("fixtures")
      .update({ status: "finished", minute_elapsed: 90, home_score: fixture.home_score, away_score: fixture.away_score })
      .eq("id", fixture.id);
  }

  const live = await rescoreLiveGameweeks(supabase);
  console.log("[live rescore]", JSON.stringify(live));

  const gw4After = await scorecardFacts(gw4.id);
  const rerun4 = { status: gw4After.totals[0]?.status, fixturesFinished: gw4After.totals[0]?.fixtures_finished, fixturesTotal: gw4After.totals[0]?.fixtures_total, fixturesWithEvents: gw4After.totals[0]?.fixtures_with_events };
  console.log("[gameweek 4, after full time]", JSON.stringify(rerun4));
  check(
    "the live re-score alone took GW4 to final — no admin action, no provider call",
    live.gameweeksScored >= 1 && gw4After.totals.every((t) => t.status === "final"),
    `scored=${live.gameweeksScored} ${gw4After.totals.map((t) => `${t.points}(${t.status})`).join(" ")}`,
  );
  const moved = gw4After.totals.filter((t) => provisionalTotals.get(t.fantasy_team_id) !== t.points);
  check(
    "the provisional total was genuinely provisional (it moved when the rest of the football landed)",
    moved.length > 0,
    gw4After.totals
      .map((t) => `${t.fantasy_team_id.slice(0, 8)}: ${provisionalTotals.get(t.fantasy_team_id)} -> ${t.points}`)
      .join("; "),
  );
  for (const total of gw4After.totals) {
    const mine = gw4After.breakdowns.filter((b) => b.fantasy_team_id === total.fantasy_team_id);
    const summed = mine.reduce((acc, b) => acc + b.total_points, 0);
    check(
      `GW4 reconciles for ${total.fantasy_team_id.slice(0, 8)}`,
      summed + total.transfer_points_cost === total.points,
      `sum(${summed}) + transfers(${total.transfer_points_cost}) === stored(${total.points})`,
    );
  }

  // ---------------------------------------------------------------- transfers
  const gw5 = await gameweek(5);
  const { data: adaTeam } = await supabase
    .from("fantasy_teams").select("id, name").eq("name", "Harbour Heroes").maybeSingle();
  const { data: previous } = await supabase
    .from("fantasy_rosters").select("player_id").eq("fantasy_team_id", adaTeam!.id).eq("gameweek_id", gw4.id);
  const { data: current } = await supabase
    .from("fantasy_rosters").select("player_id").eq("fantasy_team_id", adaTeam!.id).eq("gameweek_id", gw5.id);
  const previousIds = (previous ?? []).map((r) => r.player_id);
  const currentIds = (current ?? []).map((r) => r.player_id);

  const noChange = assessTransfers(previousIds, currentIds, FREE_TRANSFERS_PER_GAMEWEEK, TRANSFER_HIT_POINTS);
  check("an unchanged squad costs nothing", noChange.pointsCost === 0, JSON.stringify(noChange));
  check("an unchanged squad never reports minus zero", !Object.is(noChange.pointsCost, -0), String(noChange.pointsCost));

  const swapped = [...currentIds];
  const { data: spare } = await supabase
    .from("players").select("id").not("id", "in", `(${currentIds.join(",")})`).limit(2);
  swapped[0] = spare![0].id;
  const one = assessTransfers(previousIds, swapped, FREE_TRANSFERS_PER_GAMEWEEK, TRANSFER_HIT_POINTS);
  check("one change is inside the free allowance", one.pointsCost === 0, JSON.stringify(one));

  swapped[1] = spare![1].id;
  const two = assessTransfers(previousIds, swapped, FREE_TRANSFERS_PER_GAMEWEEK, TRANSFER_HIT_POINTS);
  check(
    "the second change in a gameweek costs four points",
    two.pointsCost === TRANSFER_HIT_POINTS,
    JSON.stringify(two),
  );

  const { data: storedTransfers } = await supabase
    .from("fantasy_transfers").select("is_free, points_cost").eq("gameweek_id", gw5.id);
  check(
    "the stored transfers carry their own cost",
    (storedTransfers ?? []).length === 2 &&
      storedTransfers!.some((t) => t.is_free && t.points_cost === 0) &&
      storedTransfers!.some((t) => !t.is_free && t.points_cost === -4),
    JSON.stringify(storedTransfers),
  );

  // ---------------------------------------------------------------------- done
  if (cookieReaders.length) {
    console.log("\n[note] server modules that reached for a request cookie during this run:");
    for (const line of [...new Set(cookieReaders)]) console.log(`  ${line}`);
  }

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log("failed:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main();
