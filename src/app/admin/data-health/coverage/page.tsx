import { Globe2 } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { canManageFootballData } from "@/lib/admin";
import { AdminPageHeader, AdminAccessNotice } from "@/components/admin/admin-chrome";
import { AdminSectionTabs } from "@/components/admin/admin-section-tabs";
import { CompetitionScopePanel } from "@/components/admin/competition-scope-panel";
import { ClubCataloguePanel } from "@/components/admin/club-catalogue-panel";
import { StandingsTransfersPanel } from "@/components/admin/standings-transfers-panel";
import { SquadCoveragePanel } from "@/components/admin/squad-coverage-panel";
import { SeasonDataPanel } from "@/components/admin/season-data-panel";
import { PlayerStatisticsPanel } from "@/components/admin/player-statistics-panel";
import { CompetitionCoverageMatrix } from "@/components/admin/competition-coverage-matrix";

/**
 * Football data → Coverage. What KIVO is pointed at, and how much of it is on
 * file.
 *
 * The three panels here were previously scattered through a 750-line Data
 * Health page, separated by cron history and quota ledgers, in the order they
 * were written. They belong together and they belong in this order, because
 * that is the order the work happens in:
 *
 *   1. Which competitions are in scope at all.
 *   2. Which clubs and squads exist inside those competitions.
 *   3. Which league tables and transfer histories those clubs have.
 *
 * The founder's problem was never a failed sync — every sync succeeded. It
 * succeeded at building a database of whoever happened to kick off on a Tuesday
 * in August, because that was the only shape the pipeline had. Pipeline reports
 * how well the pipeline ran; this page reports what it was aimed at.
 */
export default async function CoveragePage({
  searchParams,
}: {
  // Only the player-statistics work queue reads a query string — it is the one
  // panel here whose subject is an individual row out of thousands rather than
  // a competition or a club, so it is the one that needs to be searchable.
  searchParams: Promise<{ player?: string | string[]; competition?: string | string[] }>;
}) {
  const profile = await getOrCreateProfile();

  if (!canManageFootballData(profile?.role)) {
    return (
      <AdminAccessNotice
        title="Coverage"
        role={profile?.role}
        subject="Football data"
        because="Changing what KIVO covers writes to the football reference tables, which is limited to the football data, admin and super-admin roles."
      />
    );
  }

  const { player, competition } = await searchParams;
  const playerQuery = Array.isArray(player) ? player[0] : player;
  const competitionId = Array.isArray(competition) ? competition[0] : competition;

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionTabs groupId="football-data" />

      <AdminPageHeader
        icon={Globe2}
        title="Coverage"
        lede="The competitions KIVO covers, the clubs and squads inside them, and the league tables and transfer histories on file for each. This is what the pipeline is aimed at — Pipeline reports how well it ran."
        cost="Reading this page spends no provider quota; every count is read from KIVO's own tables. The buttons state their own cost individually, including the ones that cost nothing."
      />

      <CompetitionScopePanel />
      {/* Straight after the scope picker: scope says which competitions KIVO
          covers, this says what covering one has actually produced. */}
      <CompetitionCoverageMatrix competitionId={competitionId} />
      <ClubCataloguePanel />
      {/* Immediately under the catalogue, because it is the step the catalogue
          creates work for: a club exists here the moment its competition's
          clubs are synced, and until its squad lands the club's squad list,
          its side of every lineup and every fantasy cross-reference are empty. */}
      <SquadCoveragePanel />
      <StandingsTransfersPanel />
      {/* Absences and scoring charts last: they are the narrowest of the four,
          and both depend on the competitions above having been adopted. */}
      <SeasonDataPanel />
      <PlayerStatisticsPanel query={playerQuery} />
    </div>
  );
}
