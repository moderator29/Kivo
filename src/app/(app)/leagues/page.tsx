import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Trophy } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "leagues")!;

export const metadata: Metadata = { title: item.label };

export default async function LeaguesPage() {
  const supabase = createServerSupabaseClient();

  const { data: competitions } = await supabase
    .from("competitions")
    .select("id, name, short_name, country, logo_url, seasons(id, name, is_current)")
    .order("name", { ascending: true });

  if (!competitions || competitions.length === 0) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription!} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Leagues</h1>
        <p className="text-sm text-foreground-muted">Competitions synced from today&apos;s fixtures.</p>
      </FadeIn>

      <div className="flex flex-col gap-2">
        {competitions.map((competition, index) => {
          const currentSeason = competition.seasons?.find((s) => s.is_current) ?? competition.seasons?.[0];
          return (
            <FadeIn key={competition.id} delay={Math.min(index * 0.03, 0.3)}>
              <Link
                href={currentSeason ? `/leagues/${competition.id}` : "#"}
                className="kivo-glass-sharp flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
              >
                {competition.logo_url ? (
                  <Image src={competition.logo_url} alt={competition.name} width={32} height={32} className="h-8 w-8 shrink-0 object-contain" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5">
                    <Trophy className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                  </div>
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">{competition.name}</span>
                  <span className="text-xs text-foreground-subtle">
                    {competition.country ?? "International"}
                    {currentSeason ? ` · ${currentSeason.name}` : ""}
                  </span>
                </div>
              </Link>
            </FadeIn>
          );
        })}
      </div>
    </div>
  );
}
