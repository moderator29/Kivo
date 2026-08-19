import { CircleAlert, HeartPulse } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { getCompetitionScope } from "@/lib/football/competitions-config";
import {
  ReconcileCoverageButton,
  ReconcileSeasonStatisticsButton,
  SyncInjuriesButton,
  SyncTopScorersButton,
} from "@/components/admin/season-data-buttons";

/**
 * Absence reports and scoring charts, per competition — in Admin.
 *
 * ## Why this panel exists
 *
 * Both syncs already existed. Neither had an operator's home: the only way to
 * run either was to open a league page as a super_admin and press a control
 * rendered inside the product, next to the football it was meant to be
 * invisible behind. That is exactly backwards from this platform's rule, and it
 * had a second cost the founder named directly — a founder reviewing his own
 * product could not tell which parts of the screen the public sees.
 *
 * ## Nothing here is guessed, and nothing here is asked twice
 *
 * The "supported" column is the provider's own per-competition registry answer
 * (`provider_coverage.injuries` / `.top_scorers`), read from a table one
 * `/leagues` request already filled. A definite `false` disables the button
 * rather than spending a request to be refused again; a `null` — the registry
 * has never been read — leaves the button live, because unknown is not the same
 * as no and the response is the only honest way to find out.
 *
 * The counts are rows on file, not a health score. Zero means zero.
 */

type CompetitionRow = {
  competitionId: string;
  name: string;
  injuriesSupported: boolean | null;
  topScorersSupported: boolean | null;
  injuriesOnFile: number;
  topScorersOnFile: number;
};

export async function SeasonDataPanel() {
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();
  if (!providerName) return null;

  const supabase = createServiceRoleSupabaseClient();
  const scope = getCompetitionScope(providerName);

  // Only competitions KIVO has actually mapped can be asked about at all — an
  // unmapped competition has no provider id to send, and offering a button for
  // it would fail with "no provider mapping yet" every time.
  const { data: mappings } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id, provider_entity_id")
    .eq("provider", providerName)
    .eq("entity_type", "competition")
    .in("provider_entity_id", [...scope.orderedIds]);

  const rowsByCompetitionId = new Map<string, string>((mappings ?? []).map((m) => [m.kivo_entity_id, m.provider_entity_id]));
  const competitionIds = [...rowsByCompetitionId.keys()];

  if (competitionIds.length === 0) {
    return (
      <FadeIn className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <HeartPulse className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Absences and scoring charts
        </h2>
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground-muted">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          None of the competitions in scope has a {providerLabel ?? providerName} mapping yet, so neither sync has
          anything to ask about. Adopt them in the club catalogue above first.
        </p>
      </FadeIn>
    );
  }

  const [competitions, coverage, injuryRows, scorerRows] = await Promise.all([
    supabase.from("competitions").select("id, name, short_name").in("id", competitionIds),
    supabase
      .from("provider_coverage")
      .select("provider_competition_id, injuries, top_scorers")
      .eq("provider", providerName)
      .in("provider_competition_id", [...scope.orderedIds]),
    supabase.from("injuries").select("competition_id").in("competition_id", competitionIds),
    supabase.from("top_scorers").select("competition_id").in("competition_id", competitionIds),
  ]);

  const coverageByProviderId = new Map(
    (coverage.data ?? []).map((row) => [row.provider_competition_id, row]),
  );
  const injuryCounts = new Map<string, number>();
  for (const row of injuryRows.data ?? []) {
    if (!row.competition_id) continue;
    injuryCounts.set(row.competition_id, (injuryCounts.get(row.competition_id) ?? 0) + 1);
  }
  const scorerCounts = new Map<string, number>();
  for (const row of scorerRows.data ?? []) {
    scorerCounts.set(row.competition_id, (scorerCounts.get(row.competition_id) ?? 0) + 1);
  }

  // Ordered by the operator's own configured scope, so this list reads in the
  // same order as everything else on the page rather than by database id.
  const orderIndex = new Map([...scope.orderedIds].map((id, index) => [id, index]));
  const rankOf = (competitionId: string) =>
    orderIndex.get(rowsByCompetitionId.get(competitionId) ?? "") ?? Number.MAX_SAFE_INTEGER;
  const rows: CompetitionRow[] = (competitions.data ?? [])
    .map((competition) => {
      const registry = coverageByProviderId.get(rowsByCompetitionId.get(competition.id) ?? "");
      return {
        competitionId: competition.id,
        name: competition.short_name ?? competition.name,
        injuriesSupported: registry?.injuries ?? null,
        topScorersSupported: registry?.top_scorers ?? null,
        injuriesOnFile: injuryCounts.get(competition.id) ?? 0,
        topScorersOnFile: scorerCounts.get(competition.id) ?? 0,
      };
    })
    .sort((a, b) => rankOf(a.competitionId) - rankOf(b.competitionId));

  return (
    <FadeIn className="kivo-glass flex flex-col gap-5 rounded-2xl p-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <HeartPulse className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Absences and scoring charts
        </h2>
        <p className="text-xs leading-relaxed text-foreground-muted">
          One request per competition, per category. A competition the provider&apos;s own registry says publishes
          neither is disabled rather than asked — spending a request to be refused again is the one cost with no
          possible return.
        </p>
      </header>

      <ul className="flex flex-col divide-y divide-hairline-soft">
        {rows.map((row) => (
          <li key={row.competitionId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{row.name}</p>
              <p className="text-[11px] text-foreground-subtle">
                {row.injuriesOnFile === 0 ? "No absences on file" : `${row.injuriesOnFile} absences`}
                {" · "}
                {row.topScorersOnFile === 0 ? "no chart on file" : `${row.topScorersOnFile} chart rows`}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
              <SyncInjuriesButton competitionId={row.competitionId} supported={row.injuriesSupported} />
              <SyncTopScorersButton competitionId={row.competitionId} supported={row.topScorersSupported} />
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 rounded-xl border border-hairline-soft bg-surface-1 p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Free repasses — no provider request
        </h3>
        <p className="text-[11px] leading-relaxed text-foreground-subtle">
          Both of these revisit rows KIVO already holds and link them to competitions synced since they were written.
          Safe to run as often as anyone likes.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <ReconcileCoverageButton />
          <ReconcileSeasonStatisticsButton />
        </div>
      </div>
    </FadeIn>
  );
}
