import type { Metadata } from "next";
import Link from "next/link";
import { Compass, ShieldCheck } from "lucide-react";
import { NoDataYet } from "@/components/ui/no-data-yet";
import { FadeIn } from "@/components/ui/fade-in";
import { DiscoverCard } from "@/components/discover/discover-card";
import { SearchSurface } from "@/components/search/search-surface";
import { getPopularTeams } from "@/app/(app)/search-actions";
import { getNavItem } from "@/lib/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { staggerDelay } from "@/lib/stagger";

const item = getNavItem("discover");

export const metadata: Metadata = { title: item.label };

export default async function DiscoverPage() {
  const supabase = createServerSupabaseClient();

  // Managers and venues were missing from this hub while being real, built,
  // navigable list pages — /discover claimed to be "everything KIVO has
  // synced" and quietly was not. Same counted-or-nothing treatment as the
  // other four.
  const [
    { count: competitionCount },
    { count: teamCount },
    { count: playerCount },
    { count: transferCount },
    { count: managerCount },
    { count: venueCount },
    popularTeams,
  ] = await Promise.all([
    supabase.from("competitions").select("id", { count: "exact", head: true }),
    supabase.from("teams").select("id", { count: "exact", head: true }),
    supabase.from("players").select("id", { count: "exact", head: true }),
    supabase.from("transfers").select("id", { count: "exact", head: true }),
    supabase.from("managers").select("id", { count: "exact", head: true }),
    supabase.from("venues").select("id", { count: "exact", head: true }),
    getPopularTeams(),
  ]);

  const leagues = competitionCount ?? 0;
  const teams = teamCount ?? 0;
  const players = playerCount ?? 0;
  const transfers = transferCount ?? 0;
  const managers = managerCount ?? 0;
  const venues = venueCount ?? 0;

  // The search field's own coverage, built from the counts this page already
  // had to run — no second round of head-counts for the same five tables.
  const coverage = { teams, players, competitions: leagues, managers, venues };

  if (leagues === 0 && teams === 0 && players === 0 && transfers === 0 && managers === 0 && venues === 0) {
    return <NoDataYet icon={<item.icon className="h-6 w-6" strokeWidth={1.75} />} title={item.label} description={item.emptyDescription ?? "Nothing synced yet."} />;
  }

  const surfaces = [
    {
      href: "/leagues",
      icon: "/assets/icons/navigation/leagues.webp",
      label: "Leagues",
      count: leagues,
      countLabel: leagues === 1 ? "competition synced" : "competitions synced",
      description: "Browse every competition KIVO tracks, from top-flight leagues to cup competitions.",
    },
    {
      href: "/teams",
      icon: "/assets/icons/navigation/teams.webp",
      label: "Teams",
      count: teams,
      countLabel: teams === 1 ? "team synced" : "teams synced",
      description: "Club pages with squads, form and fixtures for every team synced into KIVO.",
    },
    {
      href: "/players",
      icon: "/assets/icons/navigation/players.webp",
      label: "Players",
      count: players,
      countLabel: players === 1 ? "player synced" : "players synced",
      description: "Profiles, stats and career details for every player in the KIVO database.",
    },
    {
      href: "/transfers",
      icon: "/assets/icons/navigation/transfers.webp",
      label: "Transfers",
      count: transfers,
      countLabel: transfers === 1 ? "transfer synced" : "transfers synced",
      description: "Confirmed transfers for players synced so far, not the full transfer market.",
    },
    {
      href: "/managers",
      icon: "/assets/icons/misc/managers.webp",
      label: "Managers",
      count: managers,
      countLabel: managers === 1 ? "manager synced" : "managers synced",
      description: "The people in the dugout, and the clubs KIVO has them at.",
    },
    {
      href: "/venues",
      icon: "/assets/icons/misc/stadiums.webp",
      label: "Venues",
      count: venues,
      countLabel: venues === 1 ? "venue synced" : "venues synced",
      description: "Grounds, cities and capacities for the stadiums KIVO has fixtures at.",
    },
  // A surface with nothing behind it is a dead end dressed as a destination,
  // so an entity list KIVO has not synced a single row of is left off the hub
  // entirely rather than shown reading "0 synced".
  ].filter((surface) => surface.count > 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-6">
        <div className="kivo-gradient-prime flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <Compass className="h-6 w-6 text-on-accent" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">Discover</h1>
          <p className="text-sm text-foreground-muted">
            Browse everything KIVO has synced. Leagues, clubs, players and transfers, all in one place.
          </p>
        </div>
      </FadeIn>

      {/* A real field, not a link to one.
          
          The founder moved search out of the HEADER; that was never an
          instruction to make it hard to find. Discover's entire job is
          browsing, and a fan who does not yet know what they are looking for
          lands here — so the field belongs here, working, at the top of the
          page. It is the same `SearchSurface` /search renders and the same
          `searchPlatform` action ⌘K calls, in its inline variant: no
          autofocus (this page has content someone may have come for, and a
          keyboard springing up over it on a phone is hostile), no URL
          rewriting, and nothing rendered below it until someone types —
          because the zero state for this field is the grid underneath it. */}
      <FadeIn delay={0.06}>
        <SearchSurface
          variant="inline"
          initialQuery=""
          initialResults={[]}
          initialError={null}
          popularTeams={popularTeams}
          coverage={coverage}
        />
      </FadeIn>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {surfaces.map((surface, index) => (
          <DiscoverCard
            key={surface.href}
            href={surface.href}
            icon={surface.icon}
            label={surface.label}
            count={surface.count}
            countLabel={surface.countLabel}
            description={surface.description}
            delay={0.1 + staggerDelay(index, 0.06)}
          />
        ))}
      </div>

      {/* RECOMMENDATIONS.md item 176: a link to the full transparency page,
          not folded into an admin-only surface. */}
      <FadeIn delay={0.1 + staggerDelay(surfaces.length, 0.06)}>
        <Link
          href="/transparency"
          className="kivo-glass kivo-glass-interactive flex items-center gap-3 rounded-2xl p-4 transition hover:-translate-y-0.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ShieldCheck className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-foreground">What KIVO knows</span>
            <span className="text-xs text-foreground-muted">See exactly what&apos;s synced right now, and how fresh it is.</span>
          </span>
        </Link>
      </FadeIn>
    </div>
  );
}
