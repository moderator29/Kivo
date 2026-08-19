import type { ReactNode } from "react";
import { ListOrdered } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * What the table says when there is no table.
 *
 * This is, today, the state almost every reader will meet: KIVO holds no
 * standings rows at all. So it is not a corner case to be got out of the way —
 * it is the component most people will judge the competition page by, and it
 * has one job that is easy to get wrong in both directions.
 *
 * It must not explain KIVO. Nothing here may mention a job, a schedule, a
 * source, a plan or a season target. A fan who opens the Premier League and
 * reads about an ingestion pipeline learns that the product is broken and that
 * it would like to talk about itself; every reference app simply says there is
 * no table and moves on.
 *
 * It must also not be *empty of meaning*. "No data" tells a reader nothing
 * about what they are waiting for. Football has a real answer to "why is there
 * no table" and it is usually one of three, so this component takes the two
 * facts that separate them — whether the season has any fixtures, and whether
 * any have been played — and says the true one:
 *
 *   - no fixtures at all → the season is not under way;
 *   - fixtures but nothing played → nobody has played yet, so there is
 *     genuinely nothing to rank;
 *   - results exist but no table → KIVO doesn't have it yet, said plainly and
 *     without a reason it cannot honestly give.
 *
 * The third is the honest floor. KIVO does not know why the table is missing,
 * and a guessed reason would be a worse lie than the absence.
 *
 * The frame is `<EmptyState>` (docs/UI_PRIMITIVES.md) at `section` tone, since
 * this fills one tab panel on a page whose header, season rail and tab rail all
 * loaded fine. Only the sentence is this file's own work — which is the point
 * of the primitive.
 */
export function StandingsEmpty({
  seasonLabel,
  fixtureCount,
  playedCount,
  action,
}: {
  /** e.g. "2025/26". Null when the competition has no season on record, in
   * which case the copy stops naming one rather than inventing "this season". */
  seasonLabel: string | null;
  /** Real fixtures KIVO holds for this season, in any status. */
  fixtureCount: number;
  /** Of those, how many have finished with a score. */
  playedCount: number;
  /** Optional next step — the fixtures tab. */
  action?: ReactNode;
}) {
  const season = seasonLabel ? `The ${seasonLabel} season` : "This season";

  const description =
    fixtureCount === 0
      ? `${season} isn't under way. The table starts the moment the first ball is kicked.`
      : playedCount === 0
        ? `Nobody has played yet. A table needs results, so this one starts with the opening round.`
        : `KIVO doesn't have the ${seasonLabel ?? "current"} table yet. The results so far are a tab away, and the table shows here as soon as it's in.`;

  return (
    <EmptyState
      icon={ListOrdered}
      tone="section"
      title="No table yet"
      description={description}
      action={action}
      className="kivo-glass rounded-2xl"
    />
  );
}
