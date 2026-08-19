/**
 * Drives Match Centre's server-side seams against seeded fixtures.
 *
 * The heatmap tab is a client component that renders a baseline from lineups
 * and events immediately, then asks the server for a version that can see
 * per-player statistics. Server-rendered HTML therefore only ever shows the
 * baseline, so checking the HTML alone would report the richer path as missing
 * when it is simply not in that response. This calls the same server action the
 * browser calls, as the same signed-in user, and looks at what comes back.
 */
import { readFileSync } from "node:fs";
import { seedCookies, clearCookies } from "./next-headers-stub";

seedCookies(readFileSync(process.env.KIVO_DRIVE_COOKIE ?? "/tmp/ada-cookie.txt", "utf8").trim());

const { loadFixtureHeatmaps } = await import("@/app/(app)/matches/heatmap-actions");
const { createServiceRoleSupabaseClient } = await import("@/lib/supabase/server");

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const supabase = createServiceRoleSupabaseClient();

async function main() {
  const { data: withStats } = await supabase
    .from("fixture_player_statistics").select("fixture_id").limit(1).maybeSingle();
  const withStatsId = withStats!.fixture_id;

  const { data: allFinished } = await supabase
    .from("fixtures").select("id").eq("status", "finished");
  const { data: anyStats } = await supabase.from("fixture_player_statistics").select("fixture_id");
  const statFixtures = new Set((anyStats ?? []).map((r) => r.fixture_id));
  const withoutStatsId = (allFinished ?? []).find((f) => !statFixtures.has(f.id))!.id;

  // ------------------------------------------------------- the richer version
  const rich = await loadFixtureHeatmaps(withStatsId, "full-match");
  check("the heatmap upgrade answers for a signed-in reader", rich.status === "ok", rich.status);
  if (rich.status === "ok") {
    const grids = Object.values(rich.heatmaps);
    check("it used the per-player statistics that exist for this fixture", rich.usedPlayerStatistics === true);
    check("every grid says how it was derived", grids.every((g) => g.derivation === "derived"), `${grids.length} grids`);
    check(
      "no grid claims tracking data KIVO does not have",
      grids.every((g) => g.derivation !== "tracked"),
    );
    // Only the grids the view can actually draw. A substitute has no place on
    // the team sheet, so the engine gives them no anchor and therefore no
    // shape — `hasData: false` — even though their statistics were counted.
    // Drawing one would be inventing a position they never held.
    const drawable = grids.filter((g) => g.hasData);
    const withheld = grids.filter((g) => !g.hasData);
    check(
      "players with no place on the team sheet get no shape at all",
      withheld.length > 0 && withheld.every((g) => g.grid.zones.every((z) => z.weight === 0)),
      `${withheld.length} of ${grids.length} withheld`,
    );
    const busiest = [...drawable].sort((a, b) => b.totalActions - a.totalActions)[0];
    check(
      "the busiest player's shape is built from real recorded actions",
      busiest.totalActions > 0,
      `${busiest.totalActions} actions, mix ${busiest.classMix.map((c) => `${c.actionClass}:${c.weight}`).join(" ")}`,
    );
    const hot = busiest.grid.zones.filter((zone) => zone.weight > 0);
    check(
      "the shape is a distribution rather than a single point",
      hot.length > 1,
      `${hot.length} of ${busiest.grid.zones.length} zones carry weight`,
    );
    check(
      "the grid is the size it says it is, and every zone is on the pitch",
      busiest.grid.zones.length === busiest.grid.rows * busiest.grid.cols &&
        busiest.grid.zones.every((z) => z.x0 >= 0 && z.x1 <= 100 && z.y0 >= 0 && z.y1 <= 100),
      `${busiest.grid.rows}x${busiest.grid.cols}`,
    );
    check(
      "density is normalised against the busiest zone",
      Math.abs(Math.max(...busiest.grid.zones.map((z) => z.density)) - 1) < 1e-9,
      `peak density ${Math.max(...busiest.grid.zones.map((z) => z.density))}`,
    );
  }

  // ------------------------------------ a fixture with no per-player statistics
  const thin = await loadFixtureHeatmaps(withoutStatsId, "full-match");
  check("a fixture with no per-player statistics still answers", thin.status === "ok", thin.status);
  if (thin.status === "ok") {
    check(
      "and says plainly that statistics did not feed it",
      thin.usedPlayerStatistics === false,
      `usedPlayerStatistics=${thin.usedPlayerStatistics}`,
    );
  }

  // ------------------------------------------------------------ the auth gate
  clearCookies();
  const signedOut = await loadFixtureHeatmaps(withStatsId, "full-match");
  check(
    "a signed-out caller gets 'unavailable', not an error and not data",
    signedOut.status === "unavailable",
    signedOut.status,
  );

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exitCode = 1;
}

main();
