import type { Metadata } from "next";
import Link from "next/link";
import { Camera, ImageIcon, ShieldHalf } from "lucide-react";
import { getOrCreateProfile } from "@/lib/profile";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ProfilePageShell } from "@/components/profile/profile-page-shell";
import { SettingRow, SettingRowGroup } from "@/components/profile/setting-row";
import { AccountSwitcherLaunchRow } from "@/components/auth/account-switcher-sheet";
import { ProfileCover } from "@/components/profile/profile-cover";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { TeamCrest } from "@/components/ui/team-crest";
import { resolveAvatarSrc, resolveBackgroundSrc } from "@/lib/kivo-assets";
import { getCountryName } from "@/lib/countries";
import { ProfileUnavailable } from "@/components/auth/profile-unavailable";

export const metadata: Metadata = { title: "Edit profile" };

/**
 * The hub. Every editable thing about a profile, one row each, each row its
 * own page.
 *
 * This is the structural answer to the complaint that started the rebuild:
 * the profile used to carry its own editors inline — a background strip, a
 * username pencil — while the bio lived in Settings and the club could not be
 * changed at all after onboarding. Nothing is edited here. This page's whole
 * job is to say what is set and where to go to change it.
 */
export default async function EditProfilePage() {
  const profile = await getOrCreateProfile();
  // The (app) layout already guarantees a signed-in viewer with a real profile
  // row, so a null here is not a guest — it is a transient read failure between
  // that check and this one. See src/lib/guest-preview.ts.
  if (!profile) return <ProfileUnavailable />;

  const supabase = createServerSupabaseClient();
  const { data: club } = profile.favourite_team_id
    ? await supabase
        .from("teams")
        .select("id, name, short_name, crest_url")
        .eq("id", profile.favourite_team_id)
        .maybeSingle()
    : { data: null };

  const avatarSrc = resolveAvatarSrc(profile);
  const coverSrc = resolveBackgroundSrc(profile);

  return (
    <ProfilePageShell title="Edit profile">
      <div className="flex flex-col items-center gap-2 pt-1">
        <Link
          href="/profile/avatar"
          aria-label="Change your avatar"
          className="kivo-focus group relative rounded-[32%]"
        >
          <span className="block rounded-[32%] bg-background p-1 ring-1 ring-hairline-soft">
            <KivoAvatar src={avatarSrc} name={profile.display_name ?? profile.username} size={104} />
          </span>
          <span className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full border border-hairline bg-surface-3 text-foreground-muted shadow-soft transition group-hover:text-foreground">
            <Camera className="h-4 w-4" strokeWidth={1.75} />
          </span>
        </Link>
        <Link href="/profile/avatar" className="kivo-focus text-xs font-semibold text-accent hover:text-accent-strong">
          Change avatar
        </Link>
      </div>

      <SettingRowGroup label="You">
        <SettingRow
          href="/profile/edit/name"
          label="Name"
          value={profile.display_name}
          placeholder="Add your name"
        />
        <SettingRow href="/profile/edit/username" label="Username" value={`@${profile.username}`} />
        <SettingRow href="/profile/edit/bio" label="Bio" value={profile.bio} placeholder="Add your bio…" />
        <SettingRow
          href="/profile/edit/country"
          label="Country"
          value={profile.country ? getCountryName(profile.country) : null}
          placeholder="Not set"
        />
      </SettingRowGroup>

      <SettingRowGroup label="Football">
        <SettingRow
          href="/profile/club"
          label="Club you support"
          leading={
            club ? (
              <TeamCrest crestUrl={club.crest_url} name={club.name} size={20} />
            ) : (
              <ShieldHalf className="h-4 w-4" strokeWidth={1.75} />
            )
          }
          value={club ? club.short_name || club.name : null}
          placeholder="Pick one club"
        />
      </SettingRowGroup>

      {/* Multi-account lives here rather than in Settings because this page is
          already the answer to "who am I on KIVO" — and switching account is
          the largest version of that question. The row opens the switcher in
          place; it does not navigate, so there is no second page to keep in
          sync with this one. */}
      <SettingRowGroup label="Accounts">
        <AccountSwitcherLaunchRow />
      </SettingRowGroup>

      {/* The cover gets a real preview rather than a row with a filename,
          because it is the one setting on this page whose value is a picture.
          A row saying "Cover: kivo-bg-04" would be both uglier and a leak of
          an internal asset id. */}
      <div className="flex flex-col gap-2">
        <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">Cover</h2>
        <div className="kivo-glass overflow-hidden rounded-2xl">
          <ProfileCover src={coverSrc} className="aspect-[16/9] w-full" sizes="(min-width: 512px) 512px, 100vw" />
          <SettingRow
            href="/profile/background"
            label="Profile background"
            leading={<ImageIcon className="h-4 w-4" strokeWidth={1.75} />}
            // No value column: the picture directly above this row IS the
            // value, and "Set" / "kivo-bg-04" next to it would be either
            // redundant or a leak of an internal asset id.
            value={null}
            placeholder=""
          />
        </div>
      </div>
    </ProfilePageShell>
  );
}
