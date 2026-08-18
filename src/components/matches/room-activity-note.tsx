import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { roomActivityLabel, type MatchRoomActivity } from "@/lib/football/match-room-activity";

/**
 * "8 people in the Room", under a fixture in a list (KN-41).
 *
 * A fixture list is a list of scores; this is what turns it into a list of
 * conversations, using `posts.fixture_id` — a foreign key that has been real
 * since migration 0001 and that no list surface had ever read.
 *
 * Two deliberate constraints:
 *
 * - **Silent at zero.** Renders `null` when nobody has posted. No "be the
 *   first to say something", no minimum-threshold theatre, no rounding. An
 *   empty Room looks exactly like it did before this existed. That is the
 *   difference between reporting a real number and manufacturing engagement.
 * - **It links to the Room, not to the match.** The whole point of the item is
 *   that Match Rooms were unreachable from the lists; a count that doesn't
 *   take you there only names the problem. Sits above the card's stretched
 *   overlay link (`relative z-10`) so it wins the tap without nesting one
 *   anchor inside another.
 */
export function RoomActivityNote({
  fixtureId,
  activity,
  className,
}: {
  fixtureId: string;
  activity: MatchRoomActivity | undefined;
  className?: string;
}) {
  const label = roomActivityLabel(activity);
  if (!label) return null;

  return (
    <Link
      href={`/matches/${fixtureId}?tab=room`}
      className={`relative z-10 inline-flex w-fit items-center gap-1.5 text-[11px] font-medium text-foreground-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${className ?? ""}`.trim()}
    >
      <MessagesSquare className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {label}
    </Link>
  );
}
