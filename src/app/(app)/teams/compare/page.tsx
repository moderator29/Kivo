import type { Metadata } from "next";
import Link from "next/link";
import { Trophy, History, Users, MapPin } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { TeamComparePicker, type CompareTeamOption } from "@/components/teams/team-compare-picker";

export const metadata: Metadata = { title: "Compare teams" };

type Supabase = ReturnType<typeof createServerSupabaseClient>;

type FormResult = "W" | "D" | "L";

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

async function getTeamCompareData(supabase: Supabase, id: string): Promise<TeamCompareData | null> {
  const [{ data: team }, { data: standingsRows }, { data: recent }, { count: squadCount }] = await Promise.all([
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

  if (!team) return null;

  const currentStanding = (standingsRows ?? []).find((s) => s.season?.is_current) ?? null;

  const form: FormResult[] = (recent ?? [])
    .map((fixture): FormResult | null => {
      if (fixture.home_score === null || fixture.away_score === null) return null;
      const isHome = fixture.home_team_id === id;
      const ownScore = isHome ? fixture.home_score : fixture.away_score;
      const oppScore = isHome ? fixture.away_score : fixture.home_score;
      if (ownScore > oppScore) return "W";
      if (ownScore < oppScore) return "L";
      return "D";
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

function FormBadges({ form }: { form: FormResult[] }) {
  if (form.length === 0) {
    return <p className="text-sm text-foreground-muted">No results synced yet.</p>;
  }
  const style: Record<FormResult, string> = {
    W: "border-live/30 bg-live/10 text-live",
    D: "border-white/10 text-foreground-muted",
    L: "border-critical/30 bg-critical/10 text-critical",
  };
  return (
    <div className="flex items-center gap-1.5">
      {form.map((result, index) => (
        <span
          key={index}
          className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${style[result]}`}
        >
          {result}
        </span>
      ))}
    </div>
  );
}

function CompareColumn({ team }: { team: TeamCompareData }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <TeamCrest crestUrl={team.crestUrl} name={team.name} size={48} />
        <Link href={`/teams/${team.id}`} className="text-base font-semibold text-foreground hover:text-kivo-cyan">
          {team.name}
        </Link>
        {team.country && <p className="text-xs text-foreground-subtle">{team.country}</p>}
        {team.venueName ? (
          <p className="flex items-center gap-1 text-[11px] text-foreground-subtle">
            <MapPin className="h-3 w-3 shrink-0" strokeWidth={1.75} />
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
                <div key={label as string} className="rounded-lg bg-white/5 px-1.5 py-1.5">
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
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const { a, b } = await searchParams;
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
          className="kivo-gradient-prime rounded-xl px-5 py-2.5 text-sm font-semibold text-kivo-white transition-opacity hover:opacity-90"
        >
          Browse teams
        </Link>
      </div>
    );
  }

  const { data: teamsRaw } = await supabase
    .from("teams")
    .select("id, name, short_name, country")
    .order("name", { ascending: true });

  const teamOptions: CompareTeamOption[] = (teamsRaw ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    shortName: t.short_name,
    country: t.country,
  }));

  const hasSelection = Boolean(a) && Boolean(b);
  const validSelection = hasSelection && a !== b;

  let teamA: TeamCompareData | null = null;
  let teamB: TeamCompareData | null = null;
  if (validSelection && a && b) {
    // `a`/`b` are already guaranteed truthy here by `validSelection` (it's
    // `Boolean(a) && Boolean(b) && a !== b`) — this extra check is only so
    // TypeScript can narrow `string | undefined` to `string` itself, instead
    // of asserting it with `!`.
    [teamA, teamB] = await Promise.all([getTeamCompareData(supabase, a), getTeamCompareData(supabase, b)]);
  }

  const notFoundSelection = validSelection && (!teamA || !teamB);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Compare teams</h1>
        <p className="text-sm text-foreground-muted">Real, synced data side by side. No AI, no guesswork.</p>
      </FadeIn>

      <FadeIn delay={0.08}>
        <TeamComparePicker teams={teamOptions} initialA={a} initialB={b} />
      </FadeIn>

      {hasSelection && !validSelection && (
        <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
          Choose two different teams to compare.
        </FadeIn>
      )}

      {notFoundSelection && (
        <FadeIn delay={0.14} className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
          <p className="text-sm text-foreground-muted">
            One of the selected teams couldn&apos;t be found. It may have been removed, or the link is incorrect.
          </p>
          <Link href="/teams" className="text-xs font-medium text-kivo-cyan hover:text-kivo-cyan/80">
            Browse teams
          </Link>
        </FadeIn>
      )}

      {teamA && teamB && (
        <>
          <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6">
            <div className="grid grid-cols-2 gap-6">
              <CompareColumn team={teamA} />
              <CompareColumn team={teamB} />
            </div>
          </FadeIn>

          <FadeIn delay={0.2} className="flex flex-col gap-2 text-center text-[11px] text-foreground-subtle">
            <div className="flex items-center justify-center gap-1.5">
              <Trophy className="h-3 w-3" strokeWidth={1.75} />
              League position
              <span aria-hidden="true">·</span>
              <History className="h-3 w-3" strokeWidth={1.75} />
              Last 5 finished results
              <span aria-hidden="true">·</span>
              <Users className="h-3 w-3" strokeWidth={1.75} />
              Squad size
            </div>
            <p>All figures come from KIVO&apos;s synced football data. Nothing here is estimated or AI-generated.</p>
          </FadeIn>
        </>
      )}

      {!hasSelection && (
        <FadeIn delay={0.14} className="kivo-glass rounded-2xl p-6 text-center text-sm text-foreground-muted">
          Pick two teams above to see how they stack up.
        </FadeIn>
      )}
    </div>
  );
}
