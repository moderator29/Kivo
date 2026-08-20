import { PlayerAvatar } from "@/components/ui/player-avatar";
import { ListRow, ListSurface } from "@/components/ui/list-surface";
import { FieldLabel } from "@/components/ui/section";
import { StatBlock, StatGrid } from "@/components/ui/stat-block";
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
    <StatGrid columns={3}>
      <StatBlock label="Players" value={players.length} />
      {/* Rendered only when it is a real average. A "—" here would be a dash
          dressed as a squad statistic. */}
      {averageAge !== null && (
        <StatBlock
          label="Average age"
          value={averageAge.toFixed(1)}
          meta={withAge.length < players.length ? `${withAge.length} with a birth date` : undefined}
        />
      )}
      {nations.size > 0 && <StatBlock label="Nations" value={nations.size} />}
    </StatGrid>
  );
}

export function SquadPanel({ groups }: { groups: SquadGroup[] }) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <FieldLabel>{group.title}</FieldLabel>
            <span className="text-[11px] tabular-nums text-foreground-subtle">{group.players.length}</span>
          </div>
          <ListSurface>
            {group.players.map((player) => (
              <ListRow
                key={player.id}
                href={`/players/${player.id}`}
                leading={<PlayerAvatar photoUrl={player.photoUrl} name={player.name} size={32} />}
                title={player.name}
                subtitle={[player.position, player.nationality].filter(Boolean).join(" · ") || undefined}
                trailing={
                  player.dateOfBirth ? (
                    <span className="tabular-nums">
                      {calculateAge(player.dateOfBirth)}
                      <span className="sr-only"> years old</span>
                    </span>
                  ) : undefined
                }
              />
            ))}
          </ListSurface>
        </div>
      ))}
    </div>
  );
}
