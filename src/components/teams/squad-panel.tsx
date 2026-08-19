import Link from "next/link";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { ListSurface, StatTile } from "@/components/football/entity-shell";
import { calculateAge } from "@/lib/format";

/**
 * The squad, grouped the way a team sheet is written: keepers, defenders,
 * midfielders, forwards.
 *
 * ## What each row carries, and why only that
 *
 * A name, a face, a position and an age. Not a shirt number — `players` has no
 * such column, and the number a fan associates with a player is exactly the
 * kind of detail that is worse invented than absent. Not goals or minutes
 * either: those live per competition in `player_season_statistics`, and a
 * single figure next to a name in a squad list would silently mean "in the
 * competitions KIVO happens to hold", which is not a season total and would be
 * read as one.
 *
 * ## The summary strip
 *
 * Squad size, average age and how many nations are represented — three numbers
 * every reference product puts at the top of a squad page, all three counted
 * from the rows immediately below them. Average age is computed only from the
 * players who actually have a date of birth, and says so, because an average
 * over an unstated subset is a different number from the one it looks like.
 */
export type SquadPlayer = {
  id: string;
  name: string;
  position: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  photoUrl: string | null;
};

export type SquadGroup = { title: string; players: SquadPlayer[] };

export function SquadSummary({ players }: { players: SquadPlayer[] }) {
  const withAge = players.filter((p) => p.dateOfBirth !== null);
  const averageAge =
    withAge.length > 0
      ? Math.round((withAge.reduce((sum, p) => sum + calculateAge(p.dateOfBirth!), 0) / withAge.length) * 10) / 10
      : null;
  const nations = new Set(players.map((p) => p.nationality).filter((n): n is string => Boolean(n)));

  return (
    <div className="grid grid-cols-3 gap-2">
      <StatTile label="Players" value={String(players.length)} />
      <StatTile
        label="Average age"
        value={averageAge === null ? "–" : averageAge.toFixed(1)}
        hint={
          averageAge !== null && withAge.length < players.length ? `of ${withAge.length} with a birth date` : undefined
        }
      />
      <StatTile label="Nations" value={nations.size > 0 ? String(nations.size) : "–"} />
    </div>
  );
}

function SquadRow({ player }: { player: SquadPlayer }) {
  const meta = [player.position, player.nationality].filter(Boolean).join(" · ");
  const age = player.dateOfBirth ? calculateAge(player.dateOfBirth) : null;

  return (
    <li>
      <Link
        href={`/players/${player.id}`}
        className="kivo-focus flex min-h-[3.25rem] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-2"
      >
        <PlayerAvatar photoUrl={player.photoUrl} name={player.name} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{player.name}</p>
          {meta && <p className="truncate text-[11px] text-foreground-subtle">{meta}</p>}
        </div>
        {age !== null && (
          <span className="shrink-0 text-xs tabular-nums text-foreground-subtle">
            {age}
            <span className="sr-only"> years old</span>
          </span>
        )}
      </Link>
    </li>
  );
}

export function SquadPanel({ groups }: { groups: SquadGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-foreground-subtle">
              {group.title}
            </span>
            <span className="text-[11px] tabular-nums text-foreground-subtle">{group.players.length}</span>
          </div>
          <ListSurface>
            {group.players.map((player) => (
              <SquadRow key={player.id} player={player} />
            ))}
          </ListSurface>
        </div>
      ))}
    </div>
  );
}
