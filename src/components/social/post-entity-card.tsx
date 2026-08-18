import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { isLiveStatus } from "@/lib/football/fixture-status";
import type { PostFixture } from "@/app/(app)/social/posts";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The match a post is about, rendered inside the post.
 *
 * A post written in a Match Room already carries `posts.fixture_id`, and that
 * post can appear in the general feed — the feed query has never filtered it
 * out. Until now it arrived as a body with no subject: "unbelievable finish"
 * with nothing on screen saying what match had one. This is the entity the
 * post is attached to, drawn from the fixture row itself.
 *
 * Nested one radius step inside the post card (`rounded-xl` inside the card's
 * `rounded-2xl`, per the container ladder's "corners nest inward" rule) and
 * sitting on `bg-surface-2` rather than its own glass tier, because it is part
 * of the post rather than a second card stacked on the first.
 *
 * Everything shown is a stored column. There is no headline number invented
 * for the sake of the shape: a finished or in-play match leads with its real
 * score, and a scheduled one leads with its kickoff time, which is the only
 * number that exists yet.
 */
export function PostEntityCard({ fixture }: { fixture: PostFixture }) {
  const hasScore = fixture.homeScore !== null && fixture.awayScore !== null;
  const live = isLiveStatus(fixture.status);

  return (
    <Link
      href={`/matches/${fixture.id}`}
      className="kivo-focus group flex items-center gap-3 rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 transition-colors hover:border-hairline-strong"
    >
      <span className="flex shrink-0 items-center -space-x-1.5">
        <TeamCrest crestUrl={fixture.homeCrestUrl} name={fixture.homeName} size={26} />
        <TeamCrest crestUrl={fixture.awayCrestUrl} name={fixture.awayName} size={26} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-foreground">
          {fixture.homeShortName || fixture.homeName} v {fixture.awayShortName || fixture.awayName}
        </span>
        <span className="truncate text-[11px] text-foreground-subtle">
          {[fixture.competitionName, formatDateTime(fixture.kickoffAt, "dayTime", "UTC")].filter(Boolean).join(" · ")}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {hasScore ? (
          <span className="flex flex-col items-end gap-0.5">
            <span
              className={cn(
                "text-base font-semibold tabular-nums leading-none",
                live ? "text-live" : "text-foreground",
              )}
            >
              {fixture.homeScore}–{fixture.awayScore}
            </span>
            <FixtureStatusBadge
              status={fixture.status}
              kickoffAt={fixture.kickoffAt}
              showLiveDot={live}
            />
          </span>
        ) : (
          <FixtureStatusBadge status={fixture.status} kickoffAt={fixture.kickoffAt} />
        )}
        <ChevronRight
          className="h-4 w-4 text-foreground-subtle transition-transform group-hover:translate-x-0.5"
          strokeWidth={1.75}
        />
      </span>
    </Link>
  );
}
