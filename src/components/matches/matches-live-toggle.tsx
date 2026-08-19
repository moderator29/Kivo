import Link from "next/link";
import { Radio } from "lucide-react";

/**
 * The Live toggle on /matches.
 *
 * A link, not client state: `/matches` is a server-rendered view of one
 * calendar day and every other choice on it — which day, which competition —
 * already lives in the URL, for the reason `MatchesCompetitionFilter` spells
 * out (a shareable, back-button-able location). "Live only" is the same kind
 * of choice and belongs in the same place. It also means the toggle works with
 * no JavaScript and needs no hydration to be correct.
 *
 * The count beside it is the real number of fixtures on this date whose status
 * is `live` or `halftime` right now — the rows the toggle would leave on
 * screen, counted from the list already fetched. It is not a live subscription
 * and does not claim to be: /live owns the continuously-updating view, and
 * `LiveFreshnessNote` there says how fresh it is. This page updates the number
 * when it re-renders.
 *
 * Rendered only when it can be a real choice — see `MatchesPage`, which shows
 * it on today's date, or on any date that genuinely has something in play.
 */
export function MatchesLiveToggle({
  active,
  liveCount,
  dateParam,
  competitionParam,
}: {
  active: boolean;
  liveCount: number;
  /** The `?date=` currently on the URL, or null for today. */
  dateParam: string | null;
  /** The `?competition=` currently on the URL, or null for all. */
  competitionParam: string | null;
}) {
  const params = new URLSearchParams();
  if (dateParam) params.set("date", dateParam);
  if (competitionParam) params.set("competition", competitionParam);
  // The toggle's target is the opposite of where it is now.
  if (!active) params.set("live", "1");
  const query = params.toString();

  return (
    <Link
      href={query ? `/matches?${query}` : "/matches"}
      scroll={false}
      aria-pressed={active}
      className={`kivo-glass-sharp kivo-focus flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-colors ${
        active ? "text-live" : "text-foreground-muted hover:text-foreground"
      }`}
    >
      <Radio className={`h-3.5 w-3.5 ${active ? "text-live" : ""}`} strokeWidth={2} />
      <span>Live</span>
      {/* A count of zero is shown rather than hidden: "Live 0" is the honest
          answer to "what is in play", and hiding it would leave the reader
          unable to tell an empty count from a broken one. */}
      <span className={active ? "text-live" : "text-foreground-subtle"}>{liveCount}</span>
    </Link>
  );
}
