import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { ComingSoon } from "@/components/ui/coming-soon";
import { FadeIn } from "@/components/ui/fade-in";
import { DiscoverCard } from "@/components/discover/discover-card";
import { NAV_ITEMS } from "@/lib/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const item = NAV_ITEMS.find((i) => i.id === "discover")!;

export const metadata: Metadata = { title: item.label };

export default async function DiscoverPage() {
  const supabase = createServerSupabaseClient();

  const [{ count: competitionCount }, { count: teamCount }, { count: playerCount }, { count: transferCount }] =
    await Promise.all([
      supabase.from("competitions").select("id", { count: "exact", head: true }),
      supabase.from("teams").select("id", { count: "exact", head: true }),
      supabase.from("players").select("id", { count: "exact", head: true }),
      supabase.from("transfers").select("id", { count: "exact", head: true }),
    ]);

  const leagues = competitionCount ?? 0;
  const teams = teamCount ?? 0;
  const players = playerCount ?? 0;
  const transfers = transferCount ?? 0;

  if (leagues === 0 && teams === 0 && players === 0 && transfers === 0) {
    return <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />;
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
      description: "Confirmed transfers, tracked as they're synced from the data pipeline.",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass-brand flex items-center gap-4 rounded-2xl p-6">
        <div className="kivo-gradient-prime flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
          <Compass className="h-6 w-6 text-kivo-white" strokeWidth={1.75} />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-foreground">Discover</h1>
          <p className="text-sm text-foreground-muted">
            Browse everything KIVO has synced. Leagues, clubs, players and transfers, all in one place.
          </p>
        </div>
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
            delay={0.1 + Math.min(index * 0.06, 0.3)}
          />
        ))}
      </div>
    </div>
  );
}
