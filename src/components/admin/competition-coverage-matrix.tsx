import Link from "next/link";
import { CheckCircle2, CircleDashed, CircleHelp, CircleSlash, Layers } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { LocalDateTime } from "@/components/ui/relative-time";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { getCompetitionScope } from "@/lib/football/competitions-config";
import { getCompetitionCoverage, type CoverageState } from "@/lib/football/coverage";

/**
 * "For this competition, what does KIVO have, and what can it ever have?"
 *
 * ## Where this came from
 *
 * This is `src/components/football/coverage-panel.tsx`, moved. That panel was
 * complete, correct and well written — and it rendered at the bottom of a
 * public competition page, returning `null` to everyone but staff. So a fan
 * never saw it (the gating was never the bug) and the founder, reviewing his
 * own product as super_admin, saw a four-state ingestion matrix on a league
 * page and reviewed it as product. It belongs here, where technical vocabulary
 * is the point.
 *
 * ## One competition at a time, and that is deliberate
 *
 * `getCompetitionCoverage` is ten counting queries. Rendering it for every
 * competition in scope would put fifty to eighty queries on a page that already
 * carries five panels, to answer a question an operator asks about one
 * competition at a time. The picker is a set of links, so nothing is computed
 * until one is chosen, and the URL is shareable.
 *
 * ## The two middle states are the whole point
 *
 * "Not synced yet" and "not available" look identical as an empty tab and mean
 * opposite things — one is work outstanding, the other is work that can never
 * be done on this plan with this provider. "Not established" is the third
 * honest answer: nobody has asked the provider what it publishes here.
 */

const STATE_STYLE: Record<CoverageState, { icon: typeof CheckCircle2; className: string; label: string }> = {
  present: { icon: CheckCircle2, className: "text-live", label: "On file" },
  "not-synced": { icon: CircleDashed, className: "text-foreground-subtle", label: "Not synced yet" },
  unsupported: { icon: CircleSlash, className: "text-warning", label: "Not available" },
  unknown: { icon: CircleHelp, className: "text-foreground-subtle", label: "Not established" },
};

export async function CompetitionCoverageMatrix({ competitionId }: { competitionId?: string }) {
  const { name: providerName } = getActiveProviderStatus();
  const supabase = createServiceRoleSupabaseClient();
  const scope = getCompetitionScope(providerName ?? undefined);

  const { data: mappings } = await supabase
    .from("provider_mappings")
    .select("kivo_entity_id, provider_entity_id")
    .eq("provider", providerName ?? "api-football")
    .eq("entity_type", "competition")
    .in("provider_entity_id", [...scope.orderedIds]);

  const providerIdByCompetition = new Map((mappings ?? []).map((row) => [row.kivo_entity_id, row.provider_entity_id]));
  const ids = [...providerIdByCompetition.keys()];

  const { data: competitions } = ids.length
    ? await supabase.from("competitions").select("id, name, short_name").in("id", ids)
    : { data: [] };

  const order = new Map([...scope.orderedIds].map((id, index) => [id, index]));
  const options = (competitions ?? [])
    .map((competition) => ({
      id: competition.id,
      label: competition.short_name ?? competition.name,
      rank: order.get(providerIdByCompetition.get(competition.id) ?? "") ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));

  if (options.length === 0) return null;

  const selected = options.find((option) => option.id === competitionId) ?? null;

  // The current season is what the registry is keyed on — a coverage answer for
  // a season nobody is looking at would be a different question with the same
  // shape, which is worse than no answer.
  const { data: season } = selected
    ? await supabase
        .from("seasons")
        .select("id")
        .eq("competition_id", selected.id)
        .eq("is_current", true)
        .limit(1)
        .maybeSingle()
    : { data: null };

  const coverage = selected ? await getCompetitionCoverage(selected.id, season?.id ?? null) : null;

  return (
    <FadeIn className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Layers className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Coverage by competition
        </h2>
        <p className="text-xs leading-relaxed text-foreground-muted">
          What KIVO holds for one competition, and whether the gaps can ever fill. Counted against KIVO&apos;s own
          tables — no provider quota spent. Pick one: nothing is computed until you do.
        </p>
      </header>

      <div className="-mx-1 flex flex-wrap gap-2 px-1">
        {options.map((option) => {
          const active = option.id === selected?.id;
          return (
            <Link
              key={option.id}
              href={active ? "/admin/football/coverage" : `/admin/football/coverage?competition=${option.id}`}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={`kivo-focusable flex min-h-11 items-center rounded-full border px-3 text-xs font-semibold transition-colors ${
                active
                  ? "border-transparent bg-accent/15 text-accent"
                  : "border-hairline text-foreground-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              {option.label}
            </Link>
          );
        })}
      </div>

      {!coverage || !selected ? (
        <p className="text-xs text-foreground-subtle">
          {options.length} competition{options.length === 1 ? "" : "s"} in scope have a provider mapping and can be
          inspected.
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-hairline-soft">
            {coverage.areas.map((area) => {
              const style = STATE_STYLE[area.state];
              const Icon = style.icon;
              return (
                <li key={area.key} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm text-foreground">{area.label}</span>
                    <span className="text-[11px] leading-relaxed text-foreground-subtle">{area.detail}</span>
                  </div>
                  <span className={`flex shrink-0 items-center gap-1 text-[11px] font-semibold ${style.className}`}>
                    <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                    {style.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {coverage.providerLabel ? (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] leading-relaxed text-foreground-subtle">
                &ldquo;Not available&rdquo; means {coverage.providerLabel} doesn&apos;t publish it for{" "}
                {selected.label} — syncing more often will never produce it. Changing provider would.
              </p>
              {/* Where the "not available" answers come from is itself worth
                  stating: a provider's own declaration and KIVO's reading of its
                  endpoint list are different levels of evidence. */}
              {coverage.registrySynced ? (
                <p className="text-[11px] leading-relaxed text-foreground-subtle">
                  Based on {coverage.providerLabel}&apos;s own published coverage for this competition
                  {coverage.registryRetrievedAt ? (
                    <>
                      , last read <LocalDateTime iso={coverage.registryRetrievedAt} format="dayTime" />
                    </>
                  ) : null}
                  .
                </p>
              ) : (
                <p className="text-[11px] leading-relaxed text-foreground-subtle">
                  KIVO hasn&apos;t read {coverage.providerLabel}&apos;s published coverage for this competition, so
                  anything marked &ldquo;not established&rdquo; is genuinely unknown rather than unavailable. The
                  registry refresh is one request and answers this for every competition at once.
                </p>
              )}
            </div>
          ) : (
            <p className="text-[11px] text-foreground-subtle">
              No provider is connected on this deployment, so nothing can be synced at all.
            </p>
          )}
        </>
      )}
    </FadeIn>
  );
}
