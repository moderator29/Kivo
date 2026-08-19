import { ListRow, ListSurface } from "@/components/ui/list-surface";
import { TeamCrest } from "@/components/ui/team-crest";

export type CompetitionClub = {
  id: string;
  name: string;
  crestUrl: string | null;
};

/**
 * The clubs in a competition.
 *
 * `ListSurface`/`ListRow` (docs/UI_PRIMITIVES.md) rather than a grid of tiles:
 * one surface with hairline-divided rows, crests on a single x, whole row a
 * link. Twenty clubs as twenty cards is the exact pattern the primitive exists
 * to stop.
 *
 * Every club here is one KIVO genuinely holds a table row or a fixture for in
 * this season. Nothing is added to round the list out to a league's expected
 * size, so a season KIVO has half a fixture list for shows half a league —
 * which is true — rather than a full one with invented members.
 */
export function CompetitionClubs({ clubs }: { clubs: CompetitionClub[] }) {
  return (
    <ListSurface>
      {clubs.map((club) => (
        <ListRow
          key={club.id}
          href={`/teams/${club.id}`}
          leading={<TeamCrest crestUrl={club.crestUrl} name={club.name} size={22} />}
          title={club.name}
          chevron
        />
      ))}
    </ListSurface>
  );
}
