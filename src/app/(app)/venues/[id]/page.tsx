import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, Users2, CalendarClock } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { MatchRow } from "@/components/matches/match-row";
import { parseUuidParam } from "@/lib/params";

// RECOMMENDATIONS.md item 166: how many of a venue's fixtures to show —
// same "Small" scope as the rest of this batch, so a plain limit rather
// than a paged "Load more" control.
const VENUE_FIXTURES_LIMIT = 20;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  const { data: venue } = await supabase.from("venues").select("name, city").eq("id", id).maybeSingle();
  const name = venue?.name;
  if (!venue || !name) return { title: "Venue" };

  const description = `${name}${venue.city ? `, ${venue.city}` : ""} on KIVO: capacity and fixtures played there.`;
  return {
    title: name,
    description,
    openGraph: { title: name, description },
    twitter: { title: name, description },
  };
}

export default async function VenueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params;
  const id = parseUuidParam(rawId);
  const supabase = createServerSupabaseClient();

  const [{ data: venue }, { data: fixtures }] = await Promise.all([
    supabase.from("venues").select("id, name, city, country, capacity").eq("id", id).maybeSingle(),
    supabase
      .from("fixtures")
      .select(
        `id, kickoff_at, status, home_score, away_score,
         competition:competitions(name, short_name),
         home_team:teams!fixtures_home_team_id_fkey(id, name, crest_url),
         away_team:teams!fixtures_away_team_id_fkey(id, name, crest_url)`,
      )
      .eq("venue_id", id)
      .order("kickoff_at", { ascending: false })
      .limit(VENUE_FIXTURES_LIMIT),
  ]);

  if (!venue) notFound();

  const metaParts = [venue.city, venue.country].filter(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <div className="kivo-glass-brand rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <FadeIn delay={0} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-2">
            <MapPin className="h-7 w-7 text-foreground-subtle" strokeWidth={1.75} />
          </FadeIn>
          <FadeIn delay={0.05} className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-foreground">{venue.name ?? "Unnamed venue"}</h1>
            {metaParts.length > 0 && <p className="text-xs text-foreground-subtle">{metaParts.join(", ")}</p>}
          </FadeIn>
        </div>

        <FadeIn delay={0.1} className="mt-4 flex items-center gap-2 text-sm text-foreground-muted">
          <Users2 className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
          {venue.capacity ? `Capacity ${formatNumber(venue.capacity)}` : "Capacity not yet synced"}
        </FadeIn>
      </div>

      <FadeIn delay={0.15} className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <CalendarClock className="h-4 w-4 text-accent" strokeWidth={1.75} />
          Fixtures at this venue
        </h2>
        {fixtures && fixtures.length > 0 ? (
          <div className="flex flex-col gap-2">
            {fixtures.map((fixture) => (
              <MatchRow key={fixture.id} fixture={fixture} />
            ))}
          </div>
        ) : (
          <div className="kivo-glass rounded-2xl p-5 text-center text-sm text-foreground-muted">
            No fixtures synced at this venue yet.
          </div>
        )}
      </FadeIn>
    </div>
  );
}
