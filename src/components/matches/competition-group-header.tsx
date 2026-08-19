import Link from "next/link";
import { CompetitionLogo } from "@/components/ui/competition-logo";
import { CompetitionFavouriteStar } from "@/components/matches/competition-favourite-star";

/**
 * The row that heads a competition's block of fixtures on /matches and /live.
 *
 * Crest, name, and the country underneath it — the shape the founder pointed
 * at — plus the star that pins the competition to the top of the list.
 *
 * ## The country line is omitted, never filled in
 *
 * `competitions.country` is null on every row the live provider has synced so
 * far. This renders nothing at all in that case: no "Unknown", no
 * "International", no em dash holding the space. See
 * src/lib/football/competition-label.ts — "International" is a fact about
 * football and a null country is a missing fact, and printing the first for
 * the second is a claim KIVO cannot support. The same applies to the name: a
 * competition KIVO cannot name gets no name, and the fixture count on the
 * right still tells a reader what the block holds.
 *
 * ## Two densities, one component
 *
 * `/matches` renders these as the spine of the page and `/live` renders them
 * inside an already-padded card, so the second needs less weight. That is a
 * size difference, not a different control — the star, the crest, the country
 * line and the link target are identical in both.
 */
export function CompetitionGroupHeader({
  competitionId,
  competitionName,
  country,
  logoUrl,
  fixtureCount,
  isFavourite,
  signedIn,
  density = "comfortable",
}: {
  competitionId: string | null;
  competitionName: string | null;
  /** `competitions.country`. Null renders no line — see above. */
  country: string | null;
  logoUrl: string | null;
  fixtureCount: number;
  isFavourite: boolean;
  signedIn: boolean;
  density?: "comfortable" | "compact";
}) {
  const compact = density === "compact";
  const crestSize = compact ? 20 : 26;
  const nameClass = compact
    ? "text-xs font-semibold text-foreground-muted"
    : "text-sm font-semibold text-foreground";

  const identity = (
    <span className="flex min-w-0 items-center gap-2">
      <CompetitionLogo logoUrl={logoUrl} name={competitionName} size={crestSize} />
      <span className="flex min-w-0 flex-col">
        {competitionName !== null && <span className={`truncate ${nameClass}`}>{competitionName}</span>}
        {country !== null && (
          <span className="truncate text-[11px] leading-tight text-foreground-subtle">{country}</span>
        )}
      </span>
    </span>
  );

  return (
    <div className={`flex items-center justify-between gap-2 ${compact ? "px-2" : "px-1"}`}>
      {competitionId && competitionName !== null ? (
        <Link
          href={`/leagues/${competitionId}`}
          className="kivo-focus min-w-0 rounded-lg transition hover:text-accent"
        >
          {identity}
        </Link>
      ) : (
        identity
      )}
      <div className="flex shrink-0 items-center gap-1">
        <span className={compact ? "text-[11px] text-foreground-subtle" : "text-xs text-foreground-subtle"}>
          {fixtureCount} {fixtureCount === 1 ? "fixture" : "fixtures"}
        </span>
        {/* No star on a group KIVO has no competition id for — there is
            nothing to write a `follows` row against. */}
        {competitionId && (
          <CompetitionFavouriteStar
            competitionId={competitionId}
            competitionName={competitionName}
            initialFavourite={isFavourite}
            signedIn={signedIn}
          />
        )}
      </div>
    </div>
  );
}
