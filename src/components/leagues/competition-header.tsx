import Link from "next/link";
import { CompetitionLogo } from "@/components/ui/competition-logo";
import { FollowButton } from "@/components/ui/follow-button";
import { FadeIn } from "@/components/ui/fade-in";
import { competitionMetaLine } from "@/lib/football/competition-label";

/**
 * A competition's identity, at the top of its page.
 *
 * Deliberately **not a card**. Every other opening on this page used to be a
 * glass box, and a screen whose first element is a box containing a name is
 * the "AI-generated dashboard" reading exactly: it treats the page's subject
 * as one more widget on the page. Real football products give the competition
 * the page — crest, name, where it is played, which season you are looking at
 * — sitting directly on the background with the tab rail beneath it.
 * `design-system.ts` says the same thing in its own words: do not turn every
 * element into a card.
 *
 * The country line follows `competitionMetaLine`, which renders nothing for a
 * competition KIVO has no country for. Never "International", never "Unknown".
 */
export function CompetitionHeader({
  competitionId,
  name,
  logoUrl,
  country,
  seasonLabel,
  isFollowing,
  viewerSignedIn,
  seasons,
  activeSeasonId,
}: {
  competitionId: string;
  name: string;
  logoUrl: string | null;
  country: string | null;
  seasonLabel: string | null;
  isFollowing: boolean;
  viewerSignedIn: boolean;
  /** Newest first. One season renders no switcher — a picker with a single
   * option is chrome pretending to be a choice. */
  seasons: { id: string; name: string; isCurrent: boolean }[];
  activeSeasonId: string | null;
}) {
  const meta = competitionMetaLine([country, seasons.length > 1 ? null : seasonLabel]);

  return (
    <div className="flex flex-col gap-4">
      <FadeIn className="flex items-center gap-3">
        <CompetitionLogo logoUrl={logoUrl} name={name} size={44} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{name}</h1>
          {meta && <p className="truncate text-xs text-foreground-subtle">{meta}</p>}
        </div>
        <FollowButton
          targetType="competition"
          targetId={competitionId}
          initialFollowing={isFollowing}
          signedIn={viewerSignedIn}
        />
      </FadeIn>

      {/* Real links, not a tab rail. Each season is a different page of the
          same competition — it has its own URL, it can be shared and opened in
          a new tab, and the whole page is re-rendered on the server for it.
          docs/UI_PRIMITIVES.md is explicit that a row of links between URLs is
          a nav and must not be announced as a tablist. */}
      {seasons.length > 1 && (
        <FadeIn delay={0.05}>
          <nav aria-label="Season" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <ul className="flex w-max gap-2">
              {seasons.map((season) => {
                const isActive = season.id === activeSeasonId;
                return (
                  <li key={season.id}>
                    <Link
                      href={`/leagues/${competitionId}?season=${season.id}`}
                      aria-current={isActive ? "page" : undefined}
                      // 44px tall: this rail is the most-tapped control on the
                      // page after the tabs themselves.
                      className={`kivo-focus flex h-11 items-center rounded-xl px-3.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? "bg-accent text-on-accent"
                          : "kivo-glass-sharp text-foreground-muted hover:text-foreground"
                      }`}
                    >
                      {season.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </FadeIn>
      )}
    </div>
  );
}
