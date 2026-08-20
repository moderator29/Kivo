import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin, CalendarClock } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { Section } from "@/components/ui/section";
import { StatBlock, StatGrid } from "@/components/ui/stat-block";
import { EmptyState } from "@/components/ui/empty-state";
import { MatchRowList } from "@/components/matches/match-row";
import { LoadFailed } from "@/components/ui/load-failed";
import { parseUuidParam } from "@/lib/params";
import { readList, readOptionalRow, readRow } from "@/lib/query-result";

// RECOMMENDATIONS.md item 166: how many of a venue's fixtures to show —
// same "Small" scope as the rest of this batch, so a plain limit rather
// than a paged "Load more" control.
const VENUE_FIXTURES_LIMIT = 20;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const supabase = createServerSupabaseClient();
  // Metadata must never take a page down, so a failed read degrades to the
  // generic title here rather than throwing — logged all the same.
  const venue = readOptionalRow(
    await supabase.from("venues").select("name, city").eq("id", id).maybeSingle(),
    "venues.metadata",
  );
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

  const [venueResult, fixturesResult] = await Promise.all([
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

  // readRow throws when the lookup *failed* and returns null only when the
  // venue genuinely is not there. Without that split a dropped connection
  // rendered "Offside. That doesn't exist." about a stadium that exists — a
  // 404 is a claim about the world, and this page used to make it on a guess.
  const venue = readRow(venueResult, "venues.detail");
  if (!venue) notFound();

  // The fixture list is beside the venue, not the venue itself: a failure here
  // shows the section's own state rather than taking the page down.
  const fixturesOutcome = readList(fixturesResult, "venues.fixtures");

  const metaParts = [venue.city, venue.country].filter(Boolean);

  return (
    <div className="kivo-page">
      {/* Not a hero card. A ground's page opened with a brand-ringed box whose
          whole content was the ground's name and one line of metadata — the
          most elevated glass tier in the system spent on a heading. The
          identity now sits on the page the way the competition header does,
          and the one number a ground has is a stat rather than a sentence. */}
      <FadeIn className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-hairline-soft bg-surface-1">
          <MapPin className="h-5 w-5 text-foreground-subtle" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground">
            {venue.name ?? "Unnamed venue"}
          </h1>
          {metaParts.length > 0 && <p className="truncate text-xs text-foreground-subtle">{metaParts.join(", ")}</p>}
        </div>
      </FadeIn>

      {/* Rendered only when there is a real capacity on record. "Capacity not
          listed" is a sentence about KIVO's records in the place a fact about
          the ground should be, and a StatBlock exists to carry a number KIVO
          has — not a dash where one is missing. */}
      {venue.capacity !== null && (
        <FadeIn delay={0.05}>
          <StatGrid>
            <StatBlock label="Capacity" value={formatNumber(venue.capacity)} />
          </StatGrid>
        </FadeIn>
      )}

      <Section title="Matches here">
        {fixturesOutcome.failed ? (
          <LoadFailed title="Matches here" tone="section" icon={<CalendarClock className="h-6 w-6" strokeWidth={1.75} />} />
        ) : fixturesOutcome.rows.length > 0 ? (
          <MatchRowList fixtures={fixturesOutcome.rows} />
        ) : (
          <EmptyState
            icon={CalendarClock}
            tone="section"
            title="No matches here yet"
            description="Nothing has been played at this ground on KIVO so far."
            className="kivo-glass rounded-2xl"
          />
        )}
      </Section>
    </div>
  );
}
