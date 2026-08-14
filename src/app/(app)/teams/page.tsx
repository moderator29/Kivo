import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Shield } from "lucide-react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { FadeIn } from "@/components/ui/fade-in";
import { ComingSoon } from "@/components/ui/coming-soon";
import { NAV_ITEMS } from "@/lib/navigation";

const item = NAV_ITEMS.find((i) => i.id === "teams")!;

export const metadata: Metadata = { title: item.label };

export default async function TeamsPage() {
  const supabase = createServerSupabaseClient();

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name, country, crest_url")
    .order("name", { ascending: true });

  if (!teams || teams.length === 0) {
    return (
      <ComingSoon icon={<item.icon className="h-9 w-9 text-kivo-white" strokeWidth={1.75} />} image={item.comingSoonImage} title={item.label} description={item.comingSoonDescription ?? "Check back soon."} />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn>
        <h1 className="text-xl font-semibold text-foreground">Teams</h1>
        <p className="text-sm text-foreground-muted">Clubs synced from today&apos;s fixtures.</p>
      </FadeIn>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {teams.map((team, index) => (
          <FadeIn key={team.id} delay={Math.min(index * 0.03, 0.3)}>
            <Link
              href={`/teams/${team.id}`}
              className="kivo-glass-sharp flex flex-col items-center gap-2 rounded-2xl p-4 text-center transition-all hover:-translate-y-0.5 hover:bg-white/[0.06]"
            >
              {team.crest_url ? (
                <Image src={team.crest_url} alt={team.name} width={36} height={36} className="h-9 w-9 object-contain" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5">
                  <Shield className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                </div>
              )}
              <span className="truncate text-xs font-semibold text-foreground">{team.short_name ?? team.name}</span>
              {team.country && <span className="truncate text-[10px] text-foreground-subtle">{team.country}</span>}
            </Link>
          </FadeIn>
        ))}
      </div>
    </div>
  );
}
