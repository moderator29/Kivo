import { Globe2, ListChecks } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { resolveCompetitionScope } from "@/lib/football/competition-scope";
import { ScopeToggleButton } from "@/components/admin/competition-scope-buttons";

/**
 * The competitions KIVO covers, and the only place they are chosen.
 *
 * ## Why this is a picker and not a text box
 *
 * The founder asked for the Saudi Pro League, MLS and an Asian league on top of
 * Europe's top five. Those did not ship, for a reason worth repeating where the
 * fix lives: **nobody could establish those league ids with certainty, and a
 * wrong league id does not fail — it silently syncs a different competition.**
 *
 * This database already holds Emperor Cup, U19 Bundesliga and III Liga Group 2
 * because a pipeline once took whatever kicked off that day. A number typed
 * from memory is the same mistake with a more confident face, and it is
 * unfalsifiable from the screen: right or wrong, the UI looks identical.
 *
 * So every row below comes from `provider_coverage` — the provider's own
 * registry, filled by one `/leagues` request that returns everything on the
 * plan with its real id, name and country. Adding a competition is clicking the
 * one you want. Nobody types an id and nobody guesses.
 *
 * ## What an empty registry means
 *
 * If the registry has not been synced there is nothing to pick from, and the
 * panel says exactly that and points at the button that fixes it — rather than
 * rendering an empty list that reads as "your plan covers nothing".
 */

/** Registry rows offered at once. The full registry is roughly a thousand
 * competitions on a paid plan; this is a picker, not a directory. */
const REGISTRY_LIMIT = 400;

export async function CompetitionScopePanel() {
  const { name: providerName, label: providerLabel } = getActiveProviderStatus();
  const supabase = createServiceRoleSupabaseClient();

  if (!providerName) {
    return null;
  }

  const [scope, registry] = await Promise.all([
    resolveCompetitionScope(supabase, providerName),
    supabase
      .from("provider_coverage")
      .select("provider_competition_id, competition_name, country")
      .eq("provider", providerName)
      .order("country", { ascending: true, nullsFirst: false })
      .order("competition_name", { ascending: true })
      .limit(REGISTRY_LIMIT),
  ]);

  const registryRows = registry.data ?? [];
  const inScope = new Set(scope.orderedIds);

  // Deduped by id: the registry carries one row per competition per season, so
  // a competition KIVO has seen across two seasons would otherwise appear
  // twice with the same button.
  const seen = new Set<string>();
  const options = registryRows.filter((row) => {
    if (seen.has(row.provider_competition_id)) return false;
    seen.add(row.provider_competition_id);
    return true;
  });

  const covered = options.filter((row) => inScope.has(row.provider_competition_id));
  const available = options.filter((row) => !inScope.has(row.provider_competition_id));

  return (
    <FadeIn>
      <section className="kivo-glass flex flex-col gap-5 rounded-2xl p-5">
        <header className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ListChecks className="h-4 w-4 text-accent" strokeWidth={1.75} />
            Competitions KIVO covers
          </h2>
          <p className="text-xs leading-relaxed text-foreground-muted">
            {scope.source === "database"
              ? `${scope.orderedIds.length} chosen here, in this order. This overrides both the environment variable and the shipped default.`
              : scope.source === "unfiltered"
                ? "No filter is set: every competition the provider reports is synced. Pick some below to narrow it."
                : `Using the ${scope.source === "env" ? "environment variable" : "shipped default"} — ${scope.orderedIds.length} competitions. Anything you pick below takes over from it.`}
          </p>
        </header>

        {options.length === 0 ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground-muted">
            <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            The coverage registry is empty, so there is nothing to pick from — this is not a statement about what your
            plan covers. Press <span className="font-semibold text-foreground">Refresh coverage registry</span> above
            first: one request, and it returns every competition {providerLabel} will give you, with its real id, name
            and country.
          </p>
        ) : (
          <>
            {covered.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  Covered, in order
                </h3>
                <ul className="flex flex-col divide-y divide-hairline-soft">
                  {covered
                    .slice()
                    .sort((a, b) => scope.orderedIds.indexOf(a.provider_competition_id) - scope.orderedIds.indexOf(b.provider_competition_id))
                    .map((row) => (
                      <CompetitionRow
                        key={row.provider_competition_id}
                        providerCompetitionId={row.provider_competition_id}
                        name={row.competition_name}
                        country={row.country}
                        inScope
                      />
                    ))}
                </ul>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                Everything else on your plan
              </h3>
              <p className="text-xs text-foreground-subtle">
                {available.length} competition{available.length === 1 ? "" : "s"}, named and located by{" "}
                {providerLabel} itself — not by KIVO.
              </p>
              <ul className="flex max-h-[26rem] flex-col divide-y divide-hairline-soft overflow-y-auto">
                {available.map((row) => (
                  <CompetitionRow
                    key={row.provider_competition_id}
                    providerCompetitionId={row.provider_competition_id}
                    name={row.competition_name}
                    country={row.country}
                    inScope={false}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </section>
    </FadeIn>
  );
}

function CompetitionRow({
  providerCompetitionId,
  name,
  country,
  inScope,
}: {
  providerCompetitionId: string;
  name: string | null;
  country: string | null;
  inScope: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="flex min-w-0 flex-col">
        {/* The provider's own name, or the bare id when it reported none. Never
            a placeholder that looks like a name. */}
        <span className="truncate text-sm text-foreground">{name ?? `Competition ${providerCompetitionId}`}</span>
        <span className="truncate text-[11px] text-foreground-subtle">
          {/* The id is shown deliberately: it is what actually goes into the
              scope, and an operator checking a competition against the
              provider's dashboard needs to see it. */}
          {[country, `id ${providerCompetitionId}`].filter(Boolean).join(" · ")}
        </span>
      </span>
      <ScopeToggleButton
        providerCompetitionId={providerCompetitionId}
        name={name ?? `Competition ${providerCompetitionId}`}
        inScope={inScope}
      />
    </li>
  );
}
