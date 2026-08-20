import type { ReactNode } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { FormBadges } from "@/components/teams/form-badges";
import { FadeIn } from "@/components/ui/fade-in";
import { FieldLabel } from "@/components/ui/section";
import { formatNumber } from "@/lib/format";
import type { FormResult } from "@/lib/football/results";

/**
 * A club's identity block: crest, name, where it is from, and the two facts
 * that define its season — where it sits and how it has been playing.
 *
 * ## What changed, and why it matters
 *
 * The old header was a crest, a name, and a line reading "Venue not yet
 * synced". That single line is most of what the founder saw: a premium-looking
 * card whose only content was an admission about KIVO's own plumbing, sitting
 * where every comparable product puts the league position and the form.
 *
 * So the header now leads with football. Position and points come from the
 * club's real standings row; the form strip comes from its real finished
 * results. Any of the three that KIVO does not hold is simply not there — the
 * header shrinks to a crest and a name, which is a perfectly dignified thing
 * for a club page to be, and says nothing about why.
 *
 * The ground is a link when KIVO has the venue and silent when it does not. It
 * is never a sentence about data.
 */
export function TeamHeader({
  name,
  crestUrl,
  country,
  foundedYear,
  venue,
  standing,
  form,
  actions,
  footer,
}: {
  name: string;
  crestUrl: string | null;
  country: string | null;
  foundedYear: number | null;
  venue: { id: string; name: string; city: string | null; capacity: number | null } | null;
  /** This club's row in the competition it has played most in this season. */
  standing: { position: number | null; points: number; played: number; competitionLabel: string | null } | null;
  /** Newest result first, at most five. Empty when there is nothing finished. */
  form: FormResult[];
  /** Save and follow. Passed in so this component stays presentational. */
  actions?: ReactNode;
  /** Compare / Ask AI style links, under the identity block. */
  footer?: ReactNode;
}) {
  const metaParts = [country, foundedYear ? `Founded ${foundedYear}` : null].filter(Boolean);
  const hasHeadline = standing !== null || form.length > 0;

  return (
    <div className="kivo-glass-brand flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <FadeIn delay={0} className="shrink-0">
          <TeamCrest crestUrl={crestUrl} name={name} size={56} />
        </FadeIn>
        <FadeIn delay={0.05} className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">{name}</h1>
          {metaParts.length > 0 && (
            <p className="mt-1 truncate text-xs text-foreground-subtle">{metaParts.join(" · ")}</p>
          )}
          {venue && (
            <Link
              href={`/venues/${venue.id}`}
              className="kivo-focus mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-foreground-muted transition hover:text-accent"
            >
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
              {/* Wraps rather than truncates: a ground's name, its city and its
                  capacity are three facts, and cutting the line mid-number
                  loses one of them entirely on a phone. */}
              <span className="min-w-0">
                {venue.name}
                {venue.city ? `, ${venue.city}` : ""}
                {venue.capacity ? ` · ${formatNumber(venue.capacity)}` : ""}
              </span>
            </Link>
          )}
        </FadeIn>
        {actions && <FadeIn delay={0.1} className="flex shrink-0 items-center gap-2">{actions}</FadeIn>}
      </div>

      {hasHeadline && (
        <FadeIn delay={0.15} className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-hairline-soft pt-4">
          {standing && (
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums leading-none text-foreground">
                {standing.position !== null ? `${standing.position}` : "–"}
                {standing.position !== null && (
                  <span className="align-super text-[11px] font-medium text-foreground-subtle">
                    {ordinalSuffix(standing.position)}
                  </span>
                )}
              </span>
              <span className="min-w-0 text-xs leading-tight text-foreground-subtle">
                {standing.competitionLabel ?? "League"}
                <br />
                {standing.points} pts · {standing.played} played
              </span>
            </div>
          )}
          {form.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <FieldLabel>Form</FieldLabel>
              <FormBadges form={form} />
            </div>
          )}
        </FadeIn>
      )}

      {footer && <FadeIn delay={0.2}>{footer}</FadeIn>}
    </div>
  );
}

/** "1st", "2nd", "3rd", "4th" … — the way a league position is spoken. */
export function ordinalSuffix(position: number): string {
  const mod100 = position % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (position % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
