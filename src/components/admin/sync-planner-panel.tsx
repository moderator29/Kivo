import Link from "next/link";
import { CalendarClock, CheckCircle2, ListChecks } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { LocalDateTime } from "@/components/ui/relative-time";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { buildSyncPlan } from "@/lib/football/sync-plan";

/**
 * KIVO_NEXT_GEN KN-107: the forward-looking half of Data Health.
 *
 * Everything else on this page is retrospective — what the pipeline did, what
 * failed, how much quota is left. All of it answers "what happened". None of it
 * answers the question an admin actually has the day before a matchday: what is
 * about to be wrong. A fixture tomorrow between two clubs whose squads have
 * never been synced will render an empty Lineups tab, and today is when that is
 * cheap to fix.
 *
 * Every row is a plain statement about rows that exist or don't right now.
 * Nothing is predicted, scored or ranked — see `src/lib/football/sync-plan.ts`
 * for exactly what each of the three checks means. Each item deep-links to the
 * page that can fix it, because a to-do list you can't act on from is a report.
 */
export async function SyncPlannerPanel() {
  const plan = await buildSyncPlan(createServiceRoleSupabaseClient());

  const total =
    plan.missingSquads.items.length + plan.missingStandings.items.length + plan.missingLineups.items.length;

  return (
    <FadeIn delay={0.19} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <CalendarClock className="h-4 w-4 text-accent" strokeWidth={1.75} />
          What needs syncing next
        </h2>
        {total === 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-live">
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
            Nothing outstanding
          </span>
        )}
      </div>

      {total === 0 ? (
        <p className="text-xs text-foreground-subtle">
          No squads, standings or lineups are missing for the next {plan.lookaheadDays} days or the last{" "}
          {plan.lookbackDays}. If KIVO has no fixtures synced at all yet, this section is empty for that reason rather
          than because everything is covered — Data Health&apos;s sync history above is where to check which it is.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <PlanSection
            title={`Teams playing in the next ${plan.lookaheadDays} days with no squad synced`}
            note="Their Lineups tab and every fantasy cross-reference will be empty until a squad sync runs."
            truncated={plan.missingSquads.truncated}
            empty="Every team with a fixture coming up has a squad synced."
            items={plan.missingSquads.items.map((item) => ({
              key: item.fixtureId,
              href: `/matches/${item.fixtureId}`,
              primary: item.label,
              secondary: item.teamsWithoutSquad.map((t) => t.name).join(", "),
              at: item.kickoffAt,
            }))}
          />

          <PlanSection
            title="Current seasons with no standings"
            note="Every team page's league position and the Standings tab stay empty for these until a standings sync runs."
            truncated={plan.missingStandings.truncated}
            empty="Every current season has a standings table."
            items={plan.missingStandings.items.map((item) => ({
              key: item.seasonId,
              href: `/leagues/${item.competitionId}`,
              primary: item.competitionName,
              secondary: item.seasonName,
              at: null,
            }))}
          />

          <PlanSection
            title={`Finished in the last ${plan.lookbackDays} days with no lineups`}
            note="Match Centre shows these as played but can't say who played."
            truncated={plan.missingLineups.truncated}
            empty="Every recently finished fixture has lineups synced."
            items={plan.missingLineups.items.map((item) => ({
              key: item.fixtureId,
              href: `/matches/${item.fixtureId}`,
              primary: item.label,
              secondary: null,
              at: item.kickoffAt,
            }))}
          />
        </div>
      )}

      <p className="text-[11px] text-foreground-subtle">
        Counted directly against KIVO&apos;s own database — no provider quota spent to produce this list.
      </p>
    </FadeIn>
  );
}

function PlanSection({
  title,
  note,
  items,
  empty,
  truncated,
}: {
  title: string;
  note: string;
  items: { key: string; href: string; primary: string; secondary: string | null; at: string | null }[];
  empty: string;
  truncated: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ListChecks className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={2} />
          {title}
          <span className="text-foreground-subtle">({items.length})</span>
        </span>
        <span className="text-[11px] text-foreground-subtle">{note}</span>
      </div>

      {items.length === 0 ? (
        <p className="text-[11px] text-foreground-subtle">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline-soft">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-xs transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-foreground">{item.primary}</span>
                  {item.secondary && <span className="truncate text-foreground-subtle">{item.secondary}</span>}
                </span>
                {item.at && (
                  <LocalDateTime iso={item.at} format="dayTime" className="shrink-0 text-foreground-subtle" />
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Said explicitly rather than implied by a list that just stops — an
          admin acting on this needs to know whether they are looking at all of
          it. */}
      {truncated && (
        <p className="text-[11px] text-foreground-subtle">
          More than this were found; only the first {items.length} are listed.
        </p>
      )}
    </div>
  );
}
