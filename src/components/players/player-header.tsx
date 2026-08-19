import type { ReactNode } from "react";
import Link from "next/link";
import { Cake, Flag } from "lucide-react";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { TeamCrest } from "@/components/ui/team-crest";
import { FadeIn } from "@/components/ui/fade-in";
import { StatTile } from "@/components/football/entity-shell";
import { calculateAge } from "@/lib/format";

/**
 * A player's identity block.
 *
 * The old one was a face, a name, and then a two-column grid whose entire
 * content on most players was "Nationality not listed" and "Date of birth not
 * listed" — two lines of KIVO admitting things, given the most valuable space
 * on the page. Missing facts are now simply missing: a player KIVO knows the
 * name and club of gets a clean header saying the name and the club.
 *
 * The club sits IN the header rather than in a section below it, because a
 * player's club is part of who they are, not a fact about them — every
 * reference product prints it under the name and none of them give it a card.
 *
 * `headline` is the four-figure strip: appearances, goals, assists and KIVO's
 * own average rating. It is passed in already computed and renders only when
 * the player has genuinely played a match KIVO holds.
 */
export function PlayerHeader({
  name,
  fullName,
  photoUrl,
  position,
  nationality,
  dateOfBirth,
  club,
  headline,
  actions,
  footer,
}: {
  name: string;
  /** Shown under the known-as name, and only when it is genuinely different. */
  fullName: string | null;
  photoUrl: string | null;
  position: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  club: { id: string; name: string; shortName: string | null; crestUrl: string | null } | null;
  headline: { label: string; value: string; hint?: string; tone?: "default" | "accent" }[];
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const showFullName = Boolean(fullName) && fullName !== name;

  return (
    <div className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <FadeIn delay={0} className="shrink-0">
          <PlayerAvatar photoUrl={photoUrl} name={name} size={64} />
        </FadeIn>
        <FadeIn delay={0.05} className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">{name}</h1>
          {showFullName && <p className="truncate text-xs text-foreground-subtle">{fullName}</p>}
          {club && (
            <Link
              href={`/teams/${club.id}`}
              className="kivo-focus mt-1.5 flex items-center gap-1.5 text-xs text-foreground-muted transition hover:text-accent"
            >
              <TeamCrest crestUrl={club.crestUrl} name={club.name} size={16} />
              <span className="truncate">{club.name}</span>
            </Link>
          )}
        </FadeIn>
        {actions && <FadeIn delay={0.1} className="flex shrink-0 items-center gap-2">{actions}</FadeIn>}
      </div>

      {(position || nationality || dateOfBirth) && (
        <FadeIn delay={0.12} className="flex flex-wrap items-center gap-2">
          {position && (
            <span className="rounded-full border border-hairline px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground-muted">
              {position}
            </span>
          )}
          {nationality && (
            <span className="flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11px] text-foreground-muted">
              <Flag className="h-3 w-3 shrink-0 text-accent" strokeWidth={2} />
              {nationality}
            </span>
          )}
          {dateOfBirth && (
            <span className="flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[11px] text-foreground-muted">
              <Cake className="h-3 w-3 shrink-0 text-accent" strokeWidth={2} />
              {/* "Age 29", not a bare "29" — beside a nationality chip, a lone
                  number next to a small glyph is a guess the reader has to
                  make. */}
              Age {calculateAge(dateOfBirth)}
            </span>
          )}
        </FadeIn>
      )}

      {headline.length > 0 && (
        <FadeIn
          delay={0.15}
          className={`grid gap-2 border-t border-hairline-soft pt-4 ${headline.length >= 4 ? "grid-cols-4" : headline.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
        >
          {headline.map((tile) => (
            <StatTile key={tile.label} label={tile.label} value={tile.value} hint={tile.hint} tone={tile.tone} />
          ))}
        </FadeIn>
      )}

      {footer && <FadeIn delay={0.2}>{footer}</FadeIn>}
    </div>
  );
}
