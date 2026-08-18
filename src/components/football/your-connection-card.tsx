import Link from "next/link";
import { ArrowUpRight, Shirt, Target } from "lucide-react";
import type { ViewerPlayerConnection, ViewerTeamConnection } from "@/lib/football/viewer-connection";

/**
 * "What you and this club have between you" (KN-46).
 *
 * Every line is the reader's own data joined to the entity on screen — their
 * predictions on this club's fixtures, their fantasy squad. Nothing here is an
 * aggregate over other users, and nothing is inferred: a line appears only when
 * its underlying count is genuinely greater than zero, so a reader with no
 * history sees no card at all rather than a row of zeroes explaining that they
 * have done nothing.
 *
 * Each line links to where that fact lives, which is the second half of the
 * point: this is a connective surface, not a scoreboard about the reader.
 */

function Row({ icon, children, href }: { icon: React.ReactNode; children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 py-2.5 text-sm text-foreground transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent">
          {icon}
        </span>
        <span className="min-w-0">{children}</span>
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" strokeWidth={2} />
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label="Your history here" className="kivo-glass rounded-2xl px-4 py-1">
      <div className="flex flex-col divide-y divide-hairline-soft">{children}</div>
    </section>
  );
}

export function YourTeamConnection({ connection }: { connection: ViewerTeamConnection }) {
  const { predictionsMade, predictionsCorrect, fantasySquadPlayers } = connection;
  if (predictionsMade === 0 && fantasySquadPlayers === 0) return null;

  return (
    <Shell>
      {predictionsMade > 0 && (
        <Row icon={<Target className="h-3.5 w-3.5" strokeWidth={2} />} href="/predictions/mine">
          You&apos;ve called{" "}
          <span className="font-semibold">
            {predictionsMade} {predictionsMade === 1 ? "match" : "matches"}
          </span>{" "}
          here
          {/* Only stated once at least one prediction has actually been
              scored — an unscored pick is neither right nor wrong, and
              "0 correct" would read as a verdict on picks that have not been
              settled yet. */}
          {predictionsCorrect > 0 ? (
            <>
              , <span className="font-semibold text-live">{predictionsCorrect} right</span> so far
            </>
          ) : null}
        </Row>
      )}
      {fantasySquadPlayers > 0 && (
        <Row icon={<Shirt className="h-3.5 w-3.5" strokeWidth={2} />} href="/fantasy">
          <span className="font-semibold">
            {fantasySquadPlayers} {fantasySquadPlayers === 1 ? "player" : "players"}
          </span>{" "}
          from your fantasy squad {fantasySquadPlayers === 1 ? "plays" : "play"} here
        </Row>
      )}
    </Shell>
  );
}

export function YourPlayerConnection({ connection }: { connection: ViewerPlayerConnection }) {
  if (!connection.inSquad) return null;

  const role = connection.isCaptain
    ? "your captain"
    : connection.isViceCaptain
      ? "your vice-captain"
      : connection.isStarting
        ? "in your starting XI"
        : "on your bench";

  return (
    <Shell>
      <Row icon={<Shirt className="h-3.5 w-3.5" strokeWidth={2} />} href="/fantasy">
        In your fantasy squad — <span className="font-semibold">{role}</span> this gameweek
      </Row>
    </Shell>
  );
}
