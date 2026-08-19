import type { Metadata } from "next";
import { isUuid } from "@/lib/params";
import Link from "next/link";
import { Trophy, History, Users, MapPin } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { QueryFailedError, readList, readRow } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { TeamComparePicker, type CompareTeamOption } from "@/components/teams/team-compare-picker";
import { FormBadges } from "@/components/teams/form-badges";
import { HeadToHeadCard } from "@/components/football/head-to-head-card";
import { getHeadToHead } from "@/lib/football/head-to-head";
import { resultFor, type FormResult } from "@/lib/football/results";

export const metadata: Metadata = { title: "Compare teams" };

type Supabase = ReturnType<typeof createServerSupabaseClient>;

type TeamCompareData = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
  crestUrl: string | null;
  venueName: string | null;
  venueCity: string | null;
  standing: {
    position: number | null;
    played: number;
    won: number;
    drawn: number;
    lost: number;
    points: number;
    competitionLabel: string | null;
  } | null;
  form: FormResult[];
  squadCount: number;
};

/**
 * SECURITY_REVIEW.md F10. `id` reaches an `.or()` below, and `.or()` takes a
 * hand-built string rather than binding its values — so an id from
 * `?a=`/`?b=` would land in PostgREST filter SYNTAX. Checked here as well as
 * at the call site, so the function is safe on its own terms rather than
 * relying on every future caller remembering to validate first.
 */
async function getTeamCompareData(supabase: Supabase, id: string): Promise<TeamCompareData | null> {
  if (!isUuid(id)) return null;

  const [teamResult, standingsResult, recentResult, { count: squadCount }] = await Promise.all([
    supabase
      .from("teams")
      .select(`id, name, short_name, country, crest_url, venue:venues(name, city)`)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("standings")
      .select(
        `played, won, drawn, lost, goals_for, goals_against, points, position,
         season:seasons(id, name, is_current, competition:competitions(id, name, short_name))`,
      )
      .eq("team_id", id),
    supabase
      .from("fixtures")
      .select("id, kickoff_at, status, home_score, away_score, home_team_id, away_team_id")
      .or(`home_team_id.eq.${id},away_team_id.eq.${id}`)
      .eq("status", "finished")
      .order("kickoff_at", { ascending: false })
      .limit(5),
    supabase.from("players").select("id", { count: "exact", head: true }).eq("current_team_id", id),
  ]);

  // `readRow`, so the caller's "no such team" branch is only ever reached
  // because the team really is absent.
  const team = readRow(teamResult, "teamsCompare.team");
  if (!team) return null;

  // Same reasoning as the player comparison: a club rendered with no league
  // position and no form beside one with both does not read as missing data,
  // it reads as a club having a terrible season. A comparison is the one shape
  // where partial data is actively worse than none.
  const standings = readList(standingsResult, "teamsCompare.standings");
  const recentForm = readList(recentResult, "teamsCompare.recentForm");
  if (standings.failed || recentForm.failed) {
    throw new QueryFailedError(
      "teamsCompare.record",
      "could not read one club's record, and half a comparison reads as a verdict",
    );
  }

  const currentStanding = standings.rows.find((s) => s.season?.is_current) ?? null;

  const form: FormResult[] = recentForm.rows
    .map((fixture): FormResult | null => {
      if (fixture.home_score === null || fixture.away_score === null) return null;
      const isHome = fixture.home_team_id === id;
      const ownScore = isHome ? fixture.home_score : fixture.away_score;
      const oppScore = isHome ? fixture.away_score : fixture.home_score;
      return resultFor(ownScore, oppScore);
    })
    .filter((result): result is FormResult => result !== null);

  return {
    id: team.id,
    name: team.name,
    shortName: team.short_name,
    country: team.country,
    crestUrl: team.crest_url,
    venueName: team.venue?.name ?? null,
    venueCity: team.venue?.city ?? null,
    standing: currentStanding
      ? {
          position: currentStanding.position,
          played: currentStanding.played,
          won: currentStanding.won,
          drawn: currentStanding.drawn,
          lost: currentStanding.lost,
          points: currentStanding.points,
          competitionLabel: currentStanding.season?.competition?.short_name ?? currentStanding.season?.competition?.name ?? null,
        }
      : null,
    form,
    squadCount: squadCount ?? 0,
  };
}

function CompareColumn({ team }: { team: TeamCompareData }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <TeamCrest crestUrl={team.crestUrl} name={team.name} size={48} />
        <Link href={`/teams/${team.id}`} className="text-base font-semibold text-foreground hover:text-accent">
          {team.name}
        </Link>
        {team.country && <p className="text-xs text-foreground-subtle">{team.country}</p>}
        {team.venueName ? (
          <p className="flex items-center gap-1 text-[11px] text-foreground-subtle">
            <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
            {team.venueName}
            {team.venueCity ? `, ${team.venueCity}` : ""}
          </p>
        ) : (
          <p className="text-[11px] text-foreground-subtle">Venue not yet synced</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {team.standing ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-foreground">
                {team.standing.position !== null ? `#${team.standing.position}` : "-"}
              </span>
              {team.standing.competitionLabel && (
                <span className="text-[11px] text-foreground-subtle">{team.standing.competitionLabel}</span>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5 text-center">
              {[
                ["W", team.standing.won],
                ["D", team.standing.drawn],
                ["L", team.standing.lost],
                ["PTS", team.standing.points],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-surface-2 px-1.5 py-1.5">
                  <div className="text-xs font-semibold text-foreground">{value}</div>
                  <div className="text-[11px] uppercase tracking-wide text-foreground-subtle">{label}</div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-foreground-muted">Not synced yet.</p>
        )}
      </div>

      <FormBadges form={team.form} />

      <p className="text-sm text-foreground-muted">
        {team.squadCount > 0 ? (
          <>
            <span className="font-semibold text-foreground">{team.squadCount}</span> players on record
          </>
        ) : (
          "Not synced yet."
        )}
      </p>
    </div>
  );
}

export default async function TeamComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string; c?: string }>;
}) {
  const { a, b, c } = await searchParams;
  const supabase = createServerSupabaseClient();

  const { count: teamCount } = await supabase.from("teams").select("id", { count: "exact", head: true });

  if (!teamCount || teamCount < 2) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-sm text-foreground-muted">
          Comparing teams needs at least two synced clubs. Check back once more teams are synced.
        </p>
        <Link
          href="/teams"
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-on-accent kivo-raise focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Browse teams
        </Link>
      </div>
    );
  }

  const teamsOutcome = readList(
    await supabase.from("teams").select("id, name, short_name, country").order("name", { ascending: true }),
    "teamsCompare.pickerOptions",
  );

  if (teamsOutcome.failed) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 lg:px-8">
        <LoadFailed
          title="The club list"
          description="KIVO couldn't read the clubs available to compare. An empty picker here would look like KIVO covering no football at all — try again."
        />
      </div>
    );
  }

  const teamOptions: CompareTeamOption[] = teamsOutcome.rows.map((t) => ({
    id: t.id,
    name: t.name,
    shortName: t.short_name,
    country: t.country,
  }));

  const hasSelection = Boolean(a) && Boolean(b);

  // `?c=` is optional: two teams is still the whole feature, and every link
  // shared before the third slot existed has to keep working exactly as it
  // did. A `?c=` that is present but malformed is treated as a bad request
  // rather than quietly ignored — silently dropping a third team the user
  // asked for would show them a two-team comparison and call it what they
  // requested.
  const requestedIds = [a, b, ...(c === undefined ? [] : [c])];

  // A non-uuid id is treated exactly like a team that does not exist: the page
  // already has an honest state for that, and it keeps a tampered query string
  // from being distinguishable from a stale link. Validated here AND inside
  // getTeamCompareData (SECURITY_REVIEW F10) — the ids reach an `.or()` filter
  // string, so the function stays safe on its own terms rather than trusting
  // this caller to have checked first.
  const validSelection =
    hasSelection &&
    requestedIds.every((id) => isUuid(id ?? "")) &&
    new Set(requestedIds).size === requestedIds.length;

  let teams: TeamCompareData[] = [];
  if (validSelection) {
    const loaded = await Promise.all(
      requestedIds.map((id) => getTeamCompareData(supabase, id as string)),
    );
    // All or nothing. A three-team comparison silently rendering two columns
    // because one id no longer resolves is a worse answer than saying so.
    teams = loaded.every((team): team is TeamCompareData => team !== null) ? loaded : [];
  }

  const notFoundSelection = validSelection && teams.length === 0;
  const [teamA, teamB] = teams;

  // RECOMMENDATIONS.md item 161: this page is the "team pages" surface for
  // head-to-head — a per-rival widget on every /teams/[id] isn't required
  // by the item, and /teams/[id] already links here ("Compare with another
  // team"), so a dedicated record between exactly the two teams someone
  // picked belongs on the page built for picking two teams, not duplicated
  // on the single-team page too.
  // Head-to-head is inherently pairwise, so three teams means three records,
  // each labelled with the pair it belongs to. Rendering one of them and
  // calling it "head to head" while a third club sits in the columns above
  // would be a record attributed to the wrong set of teams.
  const pairs: [TeamCompareData, TeamCompareData][] = [];
  for (let i = 0; i < teams.length; i += 1) {
    for (let j = i + 1; j < teams.length; j += 1) pairs.push([teams[i], teams[j]]);
  }
  const headToHeadRecords = await Promise.all(
    pairs.map(async ([left, right]) => ({
      left,
      right,
      record: await getHeadToHead(supabase, left.id, right.id),
    })),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Compare teams</h1>
        <p className="text-sm text-foreground-muted">Real, synced data side by side. No AI, no guesswork.</p>
      </FadeIn>

      <FadeIn delay={0.08}>
        <TeamComparePicker teams={teamOptions} initialA={a} initialB={b} initialC={c} />
      </FadeIn>

      {hasSelection && !validSelection && (
        <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
          Choose two or three different teams to compare.
        </FadeIn>
      )}

      {notFoundSelection && (
        <FadeIn delay={0.14} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <p className="text-sm text-foreground-muted">
            One of the selected teams couldn&apos;t be found. It may have been removed, or the link is incorrect.
          </p>
          <Link href="/teams" className="text-xs font-medium text-accent hover:text-accent/80">
            Browse teams
          </Link>
        </FadeIn>
      )}

      {teamA && teamB && (
        <>
          <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6">
            {/* Three columns do not fit a phone at a readable size, so the row
                scrolls sideways instead of crushing every figure. Two columns
                keep the layout they always had. */}
            <div className={teams.length > 2 ? "-mx-2 overflow-x-auto px-2" : ""}>
              <div className={`grid gap-6 ${teams.length > 2 ? "min-w-[34rem] grid-cols-3" : "grid-cols-2"}`}>
                {teams.map((team) => (
                  <CompareColumn key={team.id} team={team} />
                ))}
              </div>
            </div>
          </FadeIn>

          {headToHeadRecords.map(({ left, right, record }) =>
            record ? (
              <FadeIn key={`${left.id}-${right.id}`} delay={0.17}>
                <HeadToHeadCard teamA={left} teamB={right} record={record} />
              </FadeIn>
            ) : null,
          )}

          <FadeIn delay={0.2} className="flex flex-col gap-2 text-center text-[11px] text-foreground-subtle">
            <div className="flex items-center justify-center gap-1.5">
              <Trophy className="h-3 w-3" strokeWidth={2} />
              League position
              <span aria-hidden="true">·</span>
              <History className="h-3 w-3" strokeWidth={2} />
              Last 5 finished results
              <span aria-hidden="true">·</span>
              <Users className="h-3 w-3" strokeWidth={2} />
              Squad size
            </div>
            <p>All figures come from KIVO&apos;s synced football data. Nothing here is estimated or AI-generated.</p>
          </FadeIn>
        </>
      )}

      {!hasSelection && (
        <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
          Pick two teams above to see how they stack up — or three.
        </FadeIn>
      )}
    </div>
  );
}
