/**
 * What one signed-in person can actually read of another's, through the same
 * PostgREST surface the browser uses.
 *
 * Every check here runs as a real user token against real policies. A pass
 * means the policy denied it, not that the UI declined to render it — the two
 * are different guarantees and only the first one survives someone with curl.
 */
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function signIn(email: string) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.verifyOtp({ email, token: "123456", type: "email" });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  return createClient(URL_, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

async function main() {
  const ada = await signIn("ada@kivo.local");
  const bem = await signIn("bem@kivo.local");
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  const { data: teams } = await bem.from("fantasy_teams").select("id, name, owner_profile_id");
  check("a manager sees their own fantasy team", (teams ?? []).length === 1, (teams ?? []).map((t) => t.name).join(","));
  const bemTeamId = teams![0].id;

  const { data: otherSquad } = await ada.from("fantasy_rosters").select("player_id").eq("fantasy_team_id", bemTeamId);
  check("and cannot read another manager's squad", (otherSquad ?? []).length === 0, `${(otherSquad ?? []).length} rows`);

  const { data: otherPoints } = await ada.from("fantasy_points").select("points").eq("fantasy_team_id", bemTeamId);
  check("nor another manager's stored points", (otherPoints ?? []).length === 0, `${(otherPoints ?? []).length} rows`);

  const { data: otherBreakdown } = await ada
    .from("fantasy_point_breakdowns").select("total_points").eq("fantasy_team_id", bemTeamId);
  check("nor the itemised breakdown behind them", (otherBreakdown ?? []).length === 0, `${(otherBreakdown ?? []).length} rows`);

  // The leaderboard is the deliberate exception, and it goes through an RPC
  // rather than through the table — which is the whole reason the table stays
  // owner-only.
  const { data: leaderboard, error: leaderboardError } = await ada.rpc("get_fantasy_league_leaderboard", { p_team_id: (await ada.from("fantasy_teams").select("id").maybeSingle()).data!.id });
  check(
    "but the league leaderboard still shows every squad, through the RPC built for it",
    leaderboardError === null && (leaderboard ?? []).length === 2,
    leaderboardError?.message ??
      (leaderboard ?? []).map((r: { team_name: string; total_points: number }) => `${r.team_name}:${r.total_points}`).join(" "),
  );

  // Writes.
  const { error: writeError } = await ada
    .from("fantasy_rosters")
    .insert({ fantasy_team_id: bemTeamId, gameweek_id: (await ada.from("fantasy_gameweeks").select("id").eq("number", 5).maybeSingle()).data!.id, player_id: (await ada.from("players").select("id").limit(1).maybeSingle()).data!.id, is_starting: true, is_captain: false, is_vice_captain: false });
  check("no user can write a fantasy roster row at all, their own included", writeError !== null, writeError?.code ?? "no error");

  const { error: pointsWrite } = await ada.from("fantasy_points").insert({
    fantasy_team_id: (await ada.from("fantasy_teams").select("id").maybeSingle()).data!.id,
    gameweek_id: (await ada.from("fantasy_gameweeks").select("id").eq("number", 5).maybeSingle()).data!.id,
    points: 9999,
  });
  check("nor award themselves points", pointsWrite !== null, pointsWrite?.code ?? "no error");

  const { error: xpWrite } = await ada.from("xp_ledger").insert({
    profile_id: (await ada.from("profiles").select("id").maybeSingle()).data!.id, amount: 100000, reason: "manual" as never,
  });
  check("nor credit their own XP ledger", xpWrite !== null, xpWrite?.code ?? "no error");

  const { data: anonTeams } = await anon.from("teams").select("id").limit(1);
  check("a signed-out visitor reads no football data", (anonTeams ?? []).length === 0, `${(anonTeams ?? []).length} rows`);

  const { data: anonProfiles } = await anon.from("profiles").select("id").limit(1);
  check("nor any profile row", (anonProfiles ?? []).length === 0, `${(anonProfiles ?? []).length} rows`);

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main();
