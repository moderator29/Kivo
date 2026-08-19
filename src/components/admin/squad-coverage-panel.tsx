import { Users } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { SyncClubSquadButton } from "@/components/admin/squad-coverage-buttons";

/**
 * Squads, one club at a time.
 *
 * ## Why this panel is here, and why it is near the top of Coverage
 *
 * A squad sync is the second step of the whole pipeline: without one, a club's
 * Squad tab is empty, a fixture's Lineups tab skips that side entirely, every
 * fantasy cross-reference misses, and a transfer that names the club cannot be
 * resolved to it. Everything downstream of step 2 is waiting on this.
 *
 * Until now Admin could only run it in bulk — `runSquadBackfill`, which walks a
 * capped number of clubs and stops when the allowance runs out. That is the
 * right tool for filling an empty database and the wrong one for "this club's
 * page is empty and I want to fix that club". The per-club button existed, but
 * only inside the product, on the club's own public page. An operator had to
 * navigate the product as an operator to press it.
 *
 * ## Clubs with nothing on file are listed first
 *
 * The list is bounded, so ordering decides what an operator can actually reach.
 * Sorting by "no squad" first means the visible rows are always the outstanding
 * work rather than an alphabetical slice that begins at clubs already done.
 *
 * ## Every count is rows, and zero means zero
 *
 * `playersOnFile` is a count of `players.current_team_id` rows. A club showing
 * zero has genuinely never had a squad sync land for it — it is not a failed
 * read rendered as an absence, which is this project's recurring bug.
 */

/** Clubs offered a button at once. A five-league catalogue is roughly a hundred
 * clubs; this is a work queue, not a directory. */
const CLUB_LIST_LIMIT = 30;

type ClubRow = { teamId: string; teamName: string; playersOnFile: number };

export async function SquadCoveragePanel() {
  const { name: providerName } = getActiveProviderStatus();
  const supabase = createServiceRoleSupabaseClient();

  // `competition_teams` (migration 0107) is the club catalogue — read from it
  // rather than from whoever happened to play a synced fixture, which is the
  // exact bug that table was added to fix. Falls back to the plain club list
  // when the catalogue has not been built yet, so this panel is useful before
  // the first club sync rather than empty until after it.
  const { data: membership } = await supabase.from("competition_teams").select("team_id").limit(2000);
  const catalogueTeamIds = [...new Set((membership ?? []).map((row) => row.team_id))];

  const teamsQuery =
    catalogueTeamIds.length > 0
      ? supabase.from("teams").select("id, name").in("id", catalogueTeamIds).order("name").limit(400)
      : supabase.from("teams").select("id, name").order("name").limit(400);

  const [{ data: teams }, { data: playerRows }] = await Promise.all([
    teamsQuery,
    supabase.from("players").select("current_team_id").not("current_team_id", "is", null).limit(20000),
  ]);

  const squadSizeByTeam = new Map<string, number>();
  for (const row of playerRows ?? []) {
    if (!row.current_team_id) continue;
    squadSizeByTeam.set(row.current_team_id, (squadSizeByTeam.get(row.current_team_id) ?? 0) + 1);
  }

  const allClubs: ClubRow[] = (teams ?? []).map((team) => ({
    teamId: team.id,
    teamName: team.name,
    playersOnFile: squadSizeByTeam.get(team.id) ?? 0,
  }));
  const withoutSquad = allClubs.filter((club) => club.playersOnFile === 0).length;

  const clubs = [...allClubs]
    .sort((a, b) =>
      a.playersOnFile === b.playersOnFile
        ? a.teamName.localeCompare(b.teamName)
        : a.playersOnFile - b.playersOnFile,
    )
    .slice(0, CLUB_LIST_LIMIT);

  return (
    <FadeIn className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Squads, one club at a time
        </h2>
        <p className="text-xs leading-relaxed text-foreground-muted">
          {allClubs.length === 0
            ? "No clubs on file yet. Sync a competition's clubs in the catalogue above first — a club with no provider mapping cannot be squad-synced."
            : withoutSquad === 0
              ? `Every one of the ${allClubs.length} clubs on file has a squad. Re-running a club refreshes it.`
              : `${withoutSquad} of ${allClubs.length} clubs have no squad on file. Until a club has one, its squad list is empty, its side of every lineup is skipped, and every fantasy cross-reference misses it.`}
        </p>
        {!providerName && (
          <p className="text-[11px] text-warning">
            No provider is connected, so these buttons will refuse rather than spend anything.
          </p>
        )}
      </header>

      {clubs.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-hairline-soft">
            {clubs.map((club) => (
              <li
                key={club.teamId}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{club.teamName}</p>
                  <p className="text-[11px] text-foreground-subtle">
                    {club.playersOnFile === 0
                      ? "No squad on file"
                      : `${club.playersOnFile} player${club.playersOnFile === 1 ? "" : "s"} on file`}
                  </p>
                </div>
                <SyncClubSquadButton
                  teamId={club.teamId}
                  teamName={club.teamName}
                  hasSquad={club.playersOnFile > 0}
                />
              </li>
            ))}
          </ul>
          {allClubs.length > clubs.length && (
            <p className="text-[11px] text-foreground-subtle">
              Showing {clubs.length} of {allClubs.length} clubs, the ones with nothing on file first. Working through
              this list is what empties it.
            </p>
          )}
        </>
      )}
    </FadeIn>
  );
}
