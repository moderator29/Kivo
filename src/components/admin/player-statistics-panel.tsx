import Link from "next/link";
import { ChartColumn, Search, X } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { SyncPlayerSeasonStatisticsButton } from "@/components/admin/player-statistics-buttons";

/**
 * Per-player season statistics, from Admin.
 *
 * ## Why a search box and not just a list
 *
 * This is a per-player operation on a table that holds thousands of players, so
 * a bounded list can only ever be an arbitrary slice. The slice is still worth
 * showing — it is the outstanding work, squad-synced players with nothing on
 * file — but an operator who wants one specific player has to be able to reach
 * them, and "the first twenty alphabetically" is not a tool.
 *
 * The alternative was leaving the control on the player's own public page,
 * which is where it used to live: an operator navigating the product as an
 * operator, and a fan sharing their page with a sync button.
 *
 * ## Only players with a club are offered
 *
 * `syncPlayerSeasonStatistics` needs the player's provider mapping, which only
 * a squad sync creates. A player with no club has never been squad-synced, so
 * the button would fail every time — those are excluded rather than offered and
 * refused.
 */

/** Rows offered at once. A work queue, not a directory. */
const PLAYER_LIMIT = 20;

/** Same restriction, and the same reasoning, as the Users page search: PostgREST
 * reads commas and brackets in an `or=` filter as syntax, so the query is
 * limited to characters a player name can actually contain. */
function sanitiseQuery(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 40);
}

export async function PlayerStatisticsPanel({ query: rawQuery }: { query?: string }) {
  const query = sanitiseQuery(rawQuery ?? "");
  const supabase = createServiceRoleSupabaseClient();

  const [{ data: statRows }, { count: playersWithClub }] = await Promise.all([
    supabase.from("player_season_statistics").select("player_id").limit(20000),
    supabase.from("players").select("id", { count: "exact", head: true }).not("current_team_id", "is", null),
  ]);
  const withStats = new Set((statRows ?? []).map((row) => row.player_id));

  const base = supabase
    .from("players")
    .select("id, full_name, known_as, team:teams!players_current_team_id_fkey(name)")
    .not("current_team_id", "is", null);

  const { data: candidates } = query
    ? await base.or(`full_name.ilike.%${query}%,known_as.ilike.%${query}%`).order("full_name").limit(200)
    : await base.order("full_name").limit(400);

  const rows = (candidates ?? [])
    .map((player) => ({
      id: player.id,
      name: player.known_as ?? player.full_name,
      club: player.team?.name ?? null,
      hasStats: withStats.has(player.id),
    }))
    // Nothing on file first — the visible slice is then always the outstanding
    // work rather than an alphabetical slice that starts at players already done.
    .sort((a, b) => (a.hasStats === b.hasStats ? a.name.localeCompare(b.name) : a.hasStats ? 1 : -1))
    .slice(0, PLAYER_LIMIT);

  const missing = Math.max(0, (playersWithClub ?? 0) - withStats.size);

  return (
    <FadeIn className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ChartColumn className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Player season statistics
        </h2>
        <p className="text-xs leading-relaxed text-foreground-muted">
          One request per player, for that player&apos;s season split by competition. {missing === 0
            ? "Every squad-synced player has a breakdown on file."
            : `${missing} of ${playersWithClub ?? 0} squad-synced players have none on file.`}{" "}
          Only players with a club appear — the provider mapping a sync needs is created by a squad sync, so a player
          without one would fail every time.
        </p>
      </header>

      <form method="get" role="search" className="flex items-center gap-2">
        <label htmlFor="player-stats-search" className="sr-only">
          Search players by name
        </label>
        <div className="relative flex min-w-0 flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-3 h-4 w-4 text-foreground-subtle"
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <input
            id="player-stats-search"
            name="player"
            type="search"
            defaultValue={query}
            placeholder="Player name"
            autoComplete="off"
            className="kivo-focusable h-11 w-full rounded-xl border border-hairline bg-surface-1 pl-9 pr-3 text-sm text-foreground placeholder:text-foreground-subtle"
          />
        </div>
        <button
          type="submit"
          className="kivo-focusable h-11 shrink-0 rounded-xl bg-surface-2 px-4 text-sm font-semibold text-foreground transition hover:bg-surface-1"
        >
          Find
        </button>
      </form>
      {query && (
        <Link
          href="/admin/data-health/coverage"
          className="kivo-focusable -mt-2 inline-flex min-h-9 w-fit items-center gap-1 rounded-lg text-xs font-medium text-foreground-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Clear search
        </Link>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          {query
            ? `No squad-synced player's name contains “${query}”.`
            : "No players have a club on file yet. Sync a club's squad above first."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline-soft">
          {rows.map((player) => (
            <li
              key={player.id}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{player.name}</p>
                <p className="truncate text-[11px] text-foreground-subtle">
                  {player.club ?? "Club not listed"} · {player.hasStats ? "breakdown on file" : "nothing on file"}
                </p>
              </div>
              <SyncPlayerSeasonStatisticsButton
                playerId={player.id}
                playerName={player.name}
                hasStats={player.hasStats}
              />
            </li>
          ))}
        </ul>
      )}
    </FadeIn>
  );
}
