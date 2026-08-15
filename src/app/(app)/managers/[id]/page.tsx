import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRound, Flag, Cake, Shield, History } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { TeamCrest } from "@/components/ui/team-crest";
import { FormBadges } from "@/components/teams/form-badges";
import { resultFor, type FormResult } from "@/lib/football/results";
import { parseUuidParam } from "@/lib/params";
import { calculateAge } from "@/lib/format";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: manager } = await supabase.from("managers").select("full_name").eq("id", id).maybeSingle();
  if (!manager) return { title: "Manager" };

  const description = `${manager.full_name} on KIVO: nationality, current club, and that club's recent form.`;
  return {
    title: manager.full_name,
    description,
    openGraph: { title: manager.full_name, description },
    twitter: { title: manager.full_name, description },
  };
}

export default async function ManagerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = parseUuidParam(rawId);
  const supabase = createServerSupabaseClient();

  const { data: manager } = await supabase
    .from("managers")
    .select(
      `id, full_name, nationality, date_of_birth,
       current_team:teams(id, name, short_name, crest_url)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!manager) notFound();

  // RECOMMENDATIONS.md item 165: "that club's form, reusing item 160's work" —
  // same query shape (last 10 finished, newest first) and the same
  // resultFor()/FormBadges pair /teams/[id] uses for its own form strip.
  const { data: recentFixtures } = manager.current_team
    ? await supabase
        .from("fixtures")
        .select("id, home_score, away_score, home_team_id, away_team_id")
        .or(`home_team_id.eq.${manager.current_team.id},away_team_id.eq.${manager.current_team.id}`)
        .eq("status", "finished")
        .order("kickoff_at", { ascending: false })
        .limit(5)
    : { data: null };

  const clubForm: FormResult[] = (recentFixtures ?? [])
    .map((fixture): FormResult | null => {
      if (fixture.home_score === null || fixture.away_score === null || !manager.current_team) return null;
      const isHome = fixture.home_team_id === manager.current_team.id;
      const ownScore = isHome ? fixture.home_score : fixture.away_score;
      const oppScore = isHome ? fixture.away_score : fixture.home_score;
      return resultFor(ownScore, oppScore);
    })
    .filter((result): result is FormResult => result !== null);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="kivo-glass-brand rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <FadeIn delay={0} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/5">
            <UserRound className="h-7 w-7 text-foreground-subtle" strokeWidth={1.75} />
          </FadeIn>
          <FadeIn delay={0.05} className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{manager.full_name}</h1>
          </FadeIn>
        </div>

        <FadeIn delay={0.15} className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Flag className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
            {manager.nationality ?? "Nationality not yet synced"}
          </div>
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            <Cake className="h-4 w-4 shrink-0 text-kivo-cyan" strokeWidth={1.75} />
            {manager.date_of_birth ? `Age ${calculateAge(manager.date_of_birth)}` : "Date of birth not yet synced"}
          </div>
        </FadeIn>
      </div>

      <FadeIn delay={0.2} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Shield className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Current club
        </h2>
        {manager.current_team ? (
          <Link
            href={`/teams/${manager.current_team.id}`}
            className="kivo-glass flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
          >
            <TeamCrest crestUrl={manager.current_team.crest_url} name={manager.current_team.name} />
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">{manager.current_team.name}</p>
              {manager.current_team.short_name && (
                <p className="truncate text-[11px] text-foreground-subtle">{manager.current_team.short_name}</p>
              )}
            </div>
          </Link>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No current club on record.
          </div>
        )}
      </FadeIn>

      {manager.current_team && (
        <FadeIn delay={0.25} className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            <History className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
            {manager.current_team.short_name ?? manager.current_team.name}&apos;s form
          </h2>
          {clubForm.length > 0 ? (
            <div className="kivo-glass rounded-2xl p-5">
              <FormBadges form={clubForm} />
            </div>
          ) : (
            <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
              No results synced yet for this club.
            </div>
          )}
        </FadeIn>
      )}
    </div>
  );
}
