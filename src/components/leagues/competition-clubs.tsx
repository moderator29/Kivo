import Link from "next/link";
import { TeamCrest } from "@/components/ui/team-crest";

export type CompetitionClub = {
  id: string;
  name: string;
  crestUrl: string | null;
};

/**
 * The clubs in a competition.
 *
 * One surface with the clubs as rows inside it, not twenty cards — the same
 * rule the match list follows (`CONTAINER_ROLES.row`: "stacked boxes are what
 * makes a list look cluttered"). The grid is a column count, not a card count:
 * the rows share one glass edge and are separated by a hairline.
 *
 * Every club here is one KIVO genuinely holds a fixture or a table row for in
 * this season. Nothing is added to round the list out to a league's expected
 * size, so a season KIVO has half a fixture list for shows half a league —
 * which is true — rather than a full one with invented members.
 */
export function CompetitionClubs({ clubs }: { clubs: CompetitionClub[] }) {
  return (
    <div className="kivo-glass overflow-hidden rounded-2xl">
      <ul className="grid grid-cols-1 sm:grid-cols-2">
        {clubs.map((club) => (
          // `border-t` with the FIRST row of the grid opting out, rather than
          // `border-b` with the last row opting out: the first row is always
          // the first one or two children whatever the total is, while "the
          // last row" depends on whether the count divides evenly and draws a
          // stray line under every odd-length list.
          <li
            key={club.id}
            className="border-t border-hairline-soft first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0"
          >
            <Link
              href={`/teams/${club.id}`}
              className="kivo-focus flex h-12 items-center gap-2.5 px-4 transition-colors hover:bg-surface-2"
            >
              <TeamCrest crestUrl={club.crestUrl} name={club.name} size={22} />
              <span className="truncate text-sm text-foreground">{club.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
