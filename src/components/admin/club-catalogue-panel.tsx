import { CircleAlert, CircleCheck, CircleHelp, Library } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { getCompetitionScope, DEFAULT_API_FOOTBALL_COMPETITIONS } from "@/lib/football/competitions-config";
import { readBudgetUsage } from "@/lib/football/request-budget";
import { SQUAD_BATCH_MAX_REQUESTS } from "@/lib/football/sync-catalogue";
import {
  AdoptCompetitionsButton,
  FillCountriesButton,
  SquadBackfillButton,
  SyncClubsButton,
} from "@/components/admin/catalogue-action-buttons";

/**
 * The club catalogue: what KIVO actually holds for each allowlisted
 * competition, and the buttons that fill it.
 *
 * ## The question this panel answers
 *
 * Data Health's other panels report what the pipeline did. This one reports
 * what the pipeline was CONFIGURED to do and how far it has got — because the
 * founder's problem was never a failed sync. Every sync succeeded. It succeeded
 * at building a database of whoever happened to kick off on a Tuesday in
 * August, because that was the only shape the pipeline had.
 *
 * ## Why the allowlist is rendered against the provider's own registry
 *
 * A hardcoded league id is a claim, and a wrong one does not fail loudly — it
 * silently syncs a different league or nothing at all. So every id in the
 * effective scope is shown beside the name and country the PROVIDER returns for
 * it, read from `provider_coverage`. An id the registry does not recognise is
 * marked as such rather than being quietly assumed correct, and the shipped
 * default list's own expectation is shown next to it so a mismatch is visible
 * at a glance rather than needing a lookup.
 *
 * Reading the registry costs nothing: it is a table one `/leagues` request
 * already filled.
 */

type CompetitionRow = {
  providerId: string;
  expectedName: string | null;
  registryName: string | null;
  registryCountry: string | null;
  competitionId: string | null;
  competitionName: string | null;
  clubsOnFile: number;
  clubsWithSquads: number;
};

export async function ClubCataloguePanel() {
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();
  const supabase = createServiceRoleSupabaseClient();

  // The scope is resolved for the provider that is actually configured. With
  // none configured there is no meaningful default (the shipped list is
  // API-Football's numbering), so the panel says that rather than showing a
  // list that would not apply.
  const scope = getCompetitionScope(providerName ?? undefined);

  const expectedByProviderId = new Map(
    (providerName === "api-football" ? DEFAULT_API_FOOTBALL_COMPETITIONS : []).map(
      (c) => [c.providerId, c.expectedName] as const,
    ),
  );

  const rows: CompetitionRow[] = [];
  let registryRowCount = 0;

  if (providerName && scope.orderedIds.length > 0) {
    const [{ data: coverageRows }, { data: mappingRows }, { count: totalRegistryRows }] = await Promise.all([
      supabase
        .from("provider_coverage")
        .select("provider_competition_id, competition_name, country, season_year")
        .eq("provider", providerName)
        .in("provider_competition_id", scope.orderedIds)
        .order("season_year", { ascending: false }),
      supabase
        .from("provider_mappings")
        .select("provider_entity_id, kivo_entity_id")
        .eq("provider", providerName)
        .eq("entity_type", "competition")
        .in("provider_entity_id", scope.orderedIds),
      supabase.from("provider_coverage").select("id", { count: "exact", head: true }).eq("provider", providerName),
    ]);

    registryRowCount = totalRegistryRows ?? 0;

    const registry = new Map<string, { name: string | null; country: string | null }>();
    for (const row of coverageRows ?? []) {
      if (registry.has(row.provider_competition_id)) continue;
      registry.set(row.provider_competition_id, { name: row.competition_name, country: row.country });
    }
    const kivoIdByProviderId = new Map((mappingRows ?? []).map((m) => [m.provider_entity_id, m.kivo_entity_id]));
    const competitionIds = Array.from(kivoIdByProviderId.values());

    // Club membership and squad coverage, both read from real rows. Two
    // separate figures deliberately: "clubs on file" and "clubs whose squad is
    // on file" are different scopes and summing or conflating them would be the
    // kind of number this project does not print.
    const membershipByCompetition = new Map<string, string[]>();
    const competitionNameById = new Map<string, string>();
    if (competitionIds.length > 0) {
      const [{ data: memberships }, { data: competitions }] = await Promise.all([
        supabase
          .from("competition_teams")
          .select("competition_id, team_id")
          .eq("provider", providerName)
          .in("competition_id", competitionIds),
        supabase.from("competitions").select("id, name").in("id", competitionIds),
      ]);
      for (const row of memberships ?? []) {
        const list = membershipByCompetition.get(row.competition_id) ?? [];
        if (!list.includes(row.team_id)) list.push(row.team_id);
        membershipByCompetition.set(row.competition_id, list);
      }
      for (const row of competitions ?? []) competitionNameById.set(row.id, row.name);
    }

    const allTeamIds = Array.from(new Set(Array.from(membershipByCompetition.values()).flat()));
    const teamsWithPlayers = new Set<string>();
    if (allTeamIds.length > 0) {
      const { data: playerRows } = await supabase
        .from("players")
        .select("current_team_id")
        .in("current_team_id", allTeamIds);
      for (const row of playerRows ?? []) {
        if (row.current_team_id) teamsWithPlayers.add(row.current_team_id);
      }
    }

    for (const providerId of scope.orderedIds) {
      const known = registry.get(providerId) ?? null;
      const competitionId = kivoIdByProviderId.get(providerId) ?? null;
      const teamIds = competitionId ? (membershipByCompetition.get(competitionId) ?? []) : [];
      rows.push({
        providerId,
        expectedName: expectedByProviderId.get(providerId) ?? null,
        registryName: known?.name ?? null,
        registryCountry: known?.country ?? null,
        competitionId,
        competitionName: competitionId ? (competitionNameById.get(competitionId) ?? null) : null,
        clubsOnFile: teamIds.length,
        clubsWithSquads: teamIds.filter((id) => teamsWithPlayers.has(id)).length,
      });
    }
  }

  const budgets = providerName ? await readBudgetUsage(supabase, providerName) : [];
  const catalogue = budgets.find((b) => b.bucket === "catalogue") ?? null;
  const remaining = catalogue ? Math.max(0, catalogue.limit - catalogue.spentInWindow) : 0;
  const clubsAffordable = Math.floor(remaining / 2);

  const scopeSentence =
    scope.source === "unfiltered"
      ? "No allowlist is in effect — every competition the provider reports for a day is synced. That is what filled this database with youth and reserve leagues."
      : scope.source === "env"
        ? "Set by FOOTBALL_SYNC_COMPETITION_IDS."
        : "KIVO's shipped default. Override it with FOOTBALL_SYNC_COMPETITION_IDS, or set that to “all” for no filter at all.";

  return (
    <FadeIn delay={0.16} className="kivo-glass flex flex-col gap-5 rounded-2xl p-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Library className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Club catalogue
        </h2>
        <p className="text-xs text-foreground-subtle">
          Clubs, squads and managers pulled by competition rather than by match day. The daily fixture sync only ever
          created the clubs that happened to be playing, which is why a club with no fixture today was not in KIVO at
          all.
        </p>
      </div>

      {!providerName ? (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          No football data provider is configured, so there is nothing to catalogue. Set API_FOOTBALL_KEY.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-foreground-muted">
              Competition scope <span className="font-normal text-foreground-subtle">— {scopeSentence}</span>
            </p>

            {scope.orderedIds.length === 0 ? (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                Nothing is allowlisted, so the catalogue has no competitions to build.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-xs">
                  <thead className="text-[11px] uppercase tracking-wide text-foreground-subtle">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Provider id</th>
                      <th className="py-1 pr-3 font-medium">{providerLabel} says it is</th>
                      <th className="py-1 pr-3 font-medium">In KIVO</th>
                      <th className="py-1 pr-3 font-medium">Clubs</th>
                      <th className="py-1 font-medium">Squads</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const mismatch =
                        row.registryName !== null &&
                        row.expectedName !== null &&
                        !row.registryName.toLowerCase().includes(row.expectedName.toLowerCase()) &&
                        !row.expectedName.toLowerCase().includes(row.registryName.toLowerCase());
                      return (
                        <tr key={row.providerId} className="border-t border-border/40 align-top">
                          <td className="py-1.5 pr-3 font-mono text-foreground-muted">{row.providerId}</td>
                          <td className="py-1.5 pr-3">
                            {row.registryName === null ? (
                              <span className="flex items-center gap-1 text-warning">
                                <CircleHelp className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                                Not in the coverage registry
                              </span>
                            ) : (
                              <span className="flex flex-col">
                                <span className={mismatch ? "text-critical" : "text-foreground"}>
                                  {row.registryName}
                                </span>
                                <span className="text-foreground-subtle">{row.registryCountry ?? "no country"}</span>
                                {mismatch && row.expectedName && (
                                  <span className="text-critical">KIVO expected {row.expectedName}</span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3">
                            {row.competitionId ? (
                              <span className="flex items-center gap-1 text-live">
                                <CircleCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                                {row.competitionName ?? "on file"}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-foreground-subtle">
                                <CircleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                                Not created yet
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-3 tabular-nums text-foreground-muted">{row.clubsOnFile}</td>
                          <td className="py-1.5 tabular-nums text-foreground-muted">
                            {row.clubsWithSquads}
                            {row.clubsOnFile > 0 ? ` / ${row.clubsOnFile}` : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {registryRowCount === 0 && (
              <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
                The coverage registry is empty, so KIVO cannot name any of these ids. Run &ldquo;Refresh coverage
                registry&rdquo; first — it is one provider request and it returns the name, country and capabilities of
                every competition your plan can see.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border/40 pt-4">
            <p className="text-xs font-medium text-foreground-muted">
              Catalogue allowance{" "}
              <span className="font-normal text-foreground-subtle">
                — {catalogue ? `${catalogue.spentInWindow} of ${catalogue.limit}` : "unknown"} requests used in the last
                24 hours. {remaining} left, which is {clubsAffordable} more club squad{clubsAffordable === 1 ? "" : "s"}{" "}
                today. This allowance is separate from the daily fixture sync&apos;s by construction, so filling the
                catalogue can never stop tomorrow&apos;s fixtures from syncing.
              </span>
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <AdoptCompetitionsButton />
            <FillCountriesButton />
            <SquadBackfillButton maxClubs={SQUAD_BATCH_MAX_REQUESTS} disabled={clubsAffordable === 0} />
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-foreground-muted">Club lists, one competition at a time</p>
              <p className="text-[11px] text-foreground-subtle">
                Each of these is 1 provider request and returns the whole league, with crests.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows
              .filter((row) => row.competitionId !== null)
              .map((row) => (
                <SyncClubsButton
                  key={row.providerId}
                  competitionId={row.competitionId as string}
                  competitionName={row.competitionName ?? row.registryName ?? row.providerId}
                  disabled={remaining < 1}
                />
              ))}
          </div>

          {rows.every((row) => row.competitionId === null) && scope.orderedIds.length > 0 && (
            <p className="text-xs text-foreground-subtle">
              No allowlisted competition exists in KIVO yet. Refresh the coverage registry, then press &ldquo;Adopt
              allowlisted competitions&rdquo; — both together cost one provider request.
            </p>
          )}
        </>
      )}
    </FadeIn>
  );
}
