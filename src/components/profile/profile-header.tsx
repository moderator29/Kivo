import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, Camera, MapPin, ShieldPlus } from "lucide-react";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { TeamCrest } from "@/components/ui/team-crest";
import { ProfileCover } from "@/components/profile/profile-cover";
import { getCountryName } from "@/lib/countries";
import { formatMonthYear, formatNumber } from "@/lib/format";

export type ProfileHeaderClub = {
  id: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
};

export type ProfileConnections = {
  following: number;
  followers: number;
  followingHref: string;
};

/**
 * The identity block every KIVO profile leads with — the caller's own
 * (`/profile`) and anyone else's (`/u/[username]`), from one component so the
 * two cannot drift.
 *
 * The shape is the one people already know from every social product: a cover
 * band, an avatar breaking across its lower edge, then name → handle → the
 * club they support → bio → where and since when → connections. That ordering
 * is not decoration. It goes identity first, allegiance second, words third,
 * facts last, so the first thing a fan reads about another fan is who they
 * are and who they support.
 *
 * Everything here is a real column: `display_name`, `username`, `bio`,
 * `country`, `created_at`, `favourite_team_id` (resolved to a club by the
 * caller) and the two `follows` counts. Nothing is rendered from a placeholder
 * — a profile with nothing filled in shows a name, a handle and a join date,
 * and no empty rows pretending to be content.
 */
export function ProfileHeader({
  displayName,
  username,
  avatarSrc,
  coverSrc,
  bio,
  country,
  joinedAt,
  club,
  action,
  connections = null,
  owner = false,
}: {
  displayName: string | null;
  username: string;
  avatarSrc: string | null;
  coverSrc: string | null;
  bio: string | null;
  /** ISO 3166-1 alpha-2, as stored. */
  country: string | null;
  /** `profiles.created_at`. */
  joinedAt: string;
  /** Resolved from `profiles.favourite_team_id`; null when unset or when no
   * clubs are synced yet. */
  club: ProfileHeaderClub | null;
  /** The trailing control: "Edit profile" for the owner, a follow button for
   * a visitor. Passed in so this component never has to know which it is. */
  action: ReactNode;
  /** Following/follower totals. Null for a profile that is not the viewer's
   * own — `follows` has no cross-user read, so KIVO genuinely cannot count
   * another person's followers, and an invented or zeroed number there would
   * be worse than none. */
  connections?: ProfileConnections | null;
  /** Owner-only affordances: the camera buttons on the cover and avatar, and
   * the "Add your club" prompt when none is set. */
  owner?: boolean;
}) {
  const name = displayName || username;

  return (
    <section className="kivo-glass overflow-hidden rounded-3xl">
      <div className="relative">
        <ProfileCover src={coverSrc} priority className="h-32 w-full sm:h-44" />
        {/* Opaque surface rather than a translucent scrim on this control and
            the avatar one below it: both sit on top of an arbitrary user image
            in both themes, and the only way to guarantee a label stays legible
            over every possible image is not to let the image through at all. */}
        {owner && (
          <Link
            href="/profile/background"
            aria-label="Change your cover image"
            className="kivo-focus absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-hairline bg-surface-3 px-3 py-1.5 text-xs font-medium text-foreground shadow-soft transition hover:border-hairline-strong"
          >
            <Camera className="h-3.5 w-3.5" strokeWidth={2} />
            Cover
          </Link>
        )}
      </div>

      <div className="px-4 pb-5 sm:px-6">
        {/* The avatar breaks the cover's lower edge; the action control sits
            on the same baseline, which is what keeps the button off the name
            line below and stops the block reading as a stack of rows. */}
        <div className="flex items-end justify-between gap-3">
          <div className="relative -mt-12">
            <div className="rounded-full bg-background p-1 ring-1 ring-hairline-soft">
              <KivoAvatar src={avatarSrc} name={name} size={92} />
            </div>
            {owner && (
              <Link
                href="/profile/avatar"
                aria-label="Change your avatar"
                className="kivo-focus absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-hairline bg-surface-3 text-foreground-muted shadow-soft transition hover:text-foreground"
              >
                <Camera className="h-4 w-4" strokeWidth={1.75} />
              </Link>
            )}
          </div>
          <div className="pb-1">{action}</div>
        </div>

        <div className="mt-3 flex flex-col gap-0.5">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{name}</h1>
          {/* With no display name the heading already IS the handle, so
              repeating it underneath says nothing. The owner gets the way to
              fix that instead; a visitor gets nothing extra, because "this
              person has not set a name" is not information about them. */}
          {displayName ? (
            <p className="truncate text-sm text-foreground-subtle">@{username}</p>
          ) : owner ? (
            <Link
              href="/profile/edit/name"
              className="kivo-focus w-fit text-sm font-medium text-accent hover:text-accent-strong"
            >
              Add your name
            </Link>
          ) : null}
        </div>

        {club ? (
          <Link
            href={`/teams/${club.id}`}
            className="kivo-focus mt-3 inline-flex w-fit max-w-full items-center gap-2 rounded-full border border-hairline bg-surface-1 py-1.5 pl-1.5 pr-3.5 transition hover:border-hairline-strong"
          >
            <TeamCrest crestUrl={club.crestUrl} name={club.name} size={22} />
            <span className="truncate text-xs font-medium text-foreground">
              Supports {club.shortName || club.name}
            </span>
          </Link>
        ) : (
          owner && (
            <Link
              href="/profile/club"
              className="kivo-focus mt-3 inline-flex w-fit items-center gap-2 rounded-full border border-dashed border-hairline-strong px-3.5 py-1.5 text-xs font-medium text-foreground-muted transition hover:text-foreground"
            >
              <ShieldPlus className="h-3.5 w-3.5" strokeWidth={2} />
              Add the club you support
            </Link>
          )
        )}

        {bio && (
          <p className="mt-3.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{bio}</p>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-foreground-subtle">
          {country && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {getCountryName(country)}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            Joined {formatMonthYear(joinedAt)}
          </span>
        </div>

        {connections && (
          <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <Link href={connections.followingHref} className="kivo-focus group flex items-baseline gap-1.5">
              <span className="font-semibold text-foreground">{formatNumber(connections.following)}</span>
              <span className="text-foreground-subtle group-hover:text-foreground-muted">Following</span>
            </Link>
            <Link href={connections.followingHref} className="kivo-focus group flex items-baseline gap-1.5">
              <span className="font-semibold text-foreground">{formatNumber(connections.followers)}</span>
              <span className="text-foreground-subtle group-hover:text-foreground-muted">
                {connections.followers === 1 ? "Follower" : "Followers"}
              </span>
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
