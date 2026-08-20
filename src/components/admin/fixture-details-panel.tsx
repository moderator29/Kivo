import { ClipboardList } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { DISPLAY_LOCALE } from "@/lib/format";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { getActiveProviderStatus } from "@/lib/football";
import { SyncFixtureDetailsButton } from "@/components/admin/fixture-details-buttons";

/**
 * Match detail — the finished fixtures whose tabs are empty, and the button
 * that fills them.
 *
 * ## Why this panel exists
 *
 * `triggerFixtureDetailsSync` had no caller. The control it belongs to used to
 * render on the public match page; the 2026-08-19 pass removed it from there
 * (correctly, per F2) without building the Admin replacement F6 recorded as the
 * follow-up, so the capability was gone and the Provider page's sync-order
 * checklist was pointing step 5 at a control that no longer existed. See
 * `fixture-details-buttons.tsx` for the full account.
 *
 * ## Why it lists only outstanding work
 *
 * This is a work queue, not a fixture directory. A fixture that already has
 * line-ups and events on file needs nothing, and listing it would push the ones
 * that do need something off the bottom. So the list is exactly "finished
 * fixtures from the last {WINDOW_DAYS} days with nothing on file", oldest
 * first, and it empties as it is worked through. When more are outstanding than
 * fit, the count says so rather than the list quietly ending.
 *
 * The window is stated rather than implied, because A6's rule is that a bounded
 * list which cannot reach an arbitrary member of its set needs a query instead.
 * This one does not claim to reach every fixture KIVO holds — it claims to hold
 * every outstanding fixture inside a named window, which is a claim it can keep.
 *
 * ## Zero means zero
 *
 * A fixture is counted as having details when a `lineups` or `fixture_events`
 * row exists for it. Both reads are counts of real rows through the service-role
 * client. An empty result here means the queue is empty, not that the read
 * failed — and a competition that publishes no line-ups at all will keep
 * returning zero after a sync, which the button's own feedback says out loud
 * rather than reporting as a failure.
 */

/** How far back the queue looks. Long enough to catch a weekend nobody
 *  reviewed, short enough that the list stays a list. */
const WINDOW_DAYS = 14;

/** Fixtures offered a button at once. */
const LIST_LIMIT = 20;

type FixtureRow = {
  id: string;
  label: string;
  kickoffAt: string;
  lineupRows: number;
  eventRows: number;
};

function formatKickoff(value: string): string {
  return new Date(value).toLocaleString(DISPLAY_LOCALE, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function FixtureDetailsPanel() {
  const { name: providerName } = getActiveProviderStatus();
  const supabase = createServiceRoleSupabaseClient();
  const since = new Date(new Date().getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: fixtures, error } = await supabase
    .from("fixtures")
    .select(
      "id, kickoff_at, home_team:teams!fixtures_home_team_id_fkey(name, short_name), away_team:teams!fixtures_away_team_id_fkey(name, short_name)",
    )
    .eq("status", "finished")
    .gte("kickoff_at", since)
    .order("kickoff_at", { ascending: true })
    .limit(400);

  if (error) {
    // "Could not be read" is not "nothing to do". A silent empty queue here
    // would tell an operator every finished match has its details, which is the
    // failed-read-drawn-as-an-empty-state bug this codebase keeps re-learning.
    return (
      <FadeIn className="kivo-glass flex flex-col gap-2 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardList className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Match detail
        </h2>
        <p className="text-xs leading-relaxed text-warning">
          The finished-fixture list couldn&apos;t be read, so KIVO can&apos;t say which matches are missing their
          line-ups. This is not an empty queue.
        </p>
      </FadeIn>
    );
  }

  const ids = (fixtures ?? []).map((fixture) => fixture.id);

  const [{ data: lineupRows }, { data: eventRows }] =
    ids.length > 0
      ? await Promise.all([
          supabase.from("lineups").select("fixture_id").in("fixture_id", ids).limit(20000),
          supabase.from("fixture_events").select("fixture_id").in("fixture_id", ids).limit(20000),
        ])
      : [{ data: [] }, { data: [] }];

  const lineupsByFixture = new Map<string, number>();
  for (const row of lineupRows ?? []) {
    lineupsByFixture.set(row.fixture_id, (lineupsByFixture.get(row.fixture_id) ?? 0) + 1);
  }
  const eventsByFixture = new Map<string, number>();
  for (const row of eventRows ?? []) {
    eventsByFixture.set(row.fixture_id, (eventsByFixture.get(row.fixture_id) ?? 0) + 1);
  }

  const all: FixtureRow[] = (fixtures ?? []).map((fixture) => ({
    id: fixture.id,
    label: `${fixture.home_team?.short_name || fixture.home_team?.name || "Home"} v ${
      fixture.away_team?.short_name || fixture.away_team?.name || "Away"
    }`,
    kickoffAt: fixture.kickoff_at,
    lineupRows: lineupsByFixture.get(fixture.id) ?? 0,
    eventRows: eventsByFixture.get(fixture.id) ?? 0,
  }));

  const outstanding = all.filter((fixture) => fixture.lineupRows === 0 && fixture.eventRows === 0);
  const shown = outstanding.slice(0, LIST_LIMIT);

  return (
    <FadeIn className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ClipboardList className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Match detail, one fixture at a time
        </h2>
        <p className="text-xs leading-relaxed text-foreground-muted">
          {all.length === 0
            ? `No fixture has finished in the last ${WINDOW_DAYS} days, so there is nothing to fill. Sync today's fixtures on Provider first if that is unexpected.`
            : outstanding.length === 0
              ? `All ${all.length} fixture(s) finished in the last ${WINDOW_DAYS} days have line-ups or events on file. Re-running one refreshes it.`
              : `${outstanding.length} of ${all.length} fixture(s) finished in the last ${WINDOW_DAYS} days have neither line-ups nor events on file. Until one does, its Line-ups and Timeline tabs are empty for every reader.`}
        </p>
        {!providerName && (
          <p className="text-[11px] text-warning">
            No provider is connected, so these buttons will refuse rather than spend anything.
          </p>
        )}
      </header>

      {shown.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-hairline-soft">
            {shown.map((fixture) => (
              <li
                key={fixture.id}
                className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{fixture.label}</p>
                  <p className="text-[11px] text-foreground-subtle">
                    {formatKickoff(fixture.kickoffAt)} · nothing on file
                  </p>
                </div>
                <SyncFixtureDetailsButton fixtureId={fixture.id} label={fixture.label} hasDetails={false} />
              </li>
            ))}
          </ul>
          {outstanding.length > shown.length && (
            <p className="text-[11px] text-foreground-subtle">
              Showing {shown.length} of {outstanding.length} outstanding, oldest first. Working through this list is
              what empties it.
            </p>
          )}
        </>
      )}
    </FadeIn>
  );
}
