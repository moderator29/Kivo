import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronRight, ShieldHalf } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { signInHref } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readList } from "@/lib/query-result";
import { LoadFailed } from "@/components/ui/load-failed";
import { RivalClubPicker } from "@/components/settings/rival-club-picker";
import { TeamCrest } from "@/components/ui/team-crest";
import { SettingsCard, SettingsPageShell } from "@/components/settings/settings-shell";
import { getSettingsSection } from "@/lib/settings-sections";
import type { ClubOption } from "@/app/(app)/settings/club-actions";

export const metadata: Metadata = { title: getSettingsSection("clubs").label };

/**
 * The place the founder asked for: "somewhere to sign up for a rival team".
 *
 * Both slots are the user's own declaration. KIVO has no rivalry dataset and no
 * editorial source for one, so nothing here is derived — a rival exists because
 * someone chose it, and until they do, /social's Rivals filter says plainly
 * that it has nothing to show rather than guessing at a derby.
 *
 * The club you support is shown here but edited at /profile/club, which owns
 * that control. One question, one editor.
 */
export default async function ClubSettingsPage() {
  const profile = await getOrCreateProfile();
  if (!profile) redirect(await signInHref());

  const ids = [profile.favourite_team_id, profile.rival_team_id].filter((id): id is string => Boolean(id));
  let clubById = new Map<string, ClubOption>();
  // The profile already says which clubs these are; this read only turns two
  // ids into two names. Failing it silently renders "You haven't chosen one
  // yet" at somebody who chose years ago — and the obvious next action is to
  // choose again, overwriting a setting that was never lost. That is why this
  // one is gated rather than tolerated, despite being a settings page.
  let clubsFailed = false;
  if (ids.length > 0) {
    const supabase = createServerSupabaseClient();
    const outcome = readList(
      await supabase.from("teams").select("id, name, short_name, crest_url, country").in("id", ids),
      "settings.clubs",
    );
    clubsFailed = outcome.failed;
    clubById = new Map(
      outcome.rows.map((t) => [
        t.id,
        { id: t.id, name: t.name, shortName: t.short_name, crestUrl: t.crest_url, country: t.country },
      ]),
    );
  }

  const supported = profile.favourite_team_id ? clubById.get(profile.favourite_team_id) ?? null : null;
  const rival = profile.rival_team_id ? clubById.get(profile.rival_team_id) ?? null : null;

  if (clubsFailed) {
    return (
      <SettingsPageShell sectionId="clubs">
        <LoadFailed
          tone="section"
          title="Your clubs"
          description="KIVO couldn't read which clubs you've chosen. They haven't changed — try again rather than picking them over."
        />
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell sectionId="clubs">
      <SettingsCard
        title="The club you support"
        description="One club, the way it works in real life. It leads your home screen and decides who your club mates are."
      >
        <Link
          href="/profile/club"
          className="kivo-focus -mx-2 flex min-h-16 items-center gap-3 rounded-xl px-2 transition-colors hover:bg-surface-2 focus-visible:ring-inset"
        >
          {supported ? (
            <>
              <TeamCrest crestUrl={supported.crestUrl} name={supported.name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{supported.name}</span>
                {supported.country && (
                  <span className="block truncate text-xs text-foreground-subtle">{supported.country}</span>
                )}
              </span>
            </>
          ) : (
            <>
              <ShieldHalf className="h-6 w-6 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">Pick your club</span>
                <span className="block text-xs text-foreground-subtle">You haven&rsquo;t chosen one yet.</span>
              </span>
            </>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-foreground-subtle/60" strokeWidth={1.75} />
        </Link>
        <p className="text-xs text-foreground-subtle">
          Fans who support the same club see your posts in their{" "}
          <Link href="/social?filter=clubmates" className="font-medium text-accent hover:underline">
            Club mates
          </Link>{" "}
          feed. That is the only place your club is used to show your posts to other people.
        </p>
      </SettingsCard>

      <SettingsCard
        title="Your rival"
        description="The club you'd never support. Nothing on KIVO decides this for you."
        delay={0.04}
      >
        <RivalClubPicker initialClub={rival} emptyPrompt="Search for your rival" />
        <p className="text-xs text-foreground-subtle">
          Naming one turns on the{" "}
          <Link href="/social?filter=rivals" className="font-medium text-accent hover:underline">
            Rivals
          </Link>{" "}
          feed — posts from fans who support that club. KIVO holds no list of which clubs are rivals, so leaving this
          empty simply means that feed has nothing to show.
        </p>
      </SettingsCard>
    </SettingsPageShell>
  );
}
