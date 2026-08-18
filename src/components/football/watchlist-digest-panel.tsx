import Link from "next/link";
import { Activity, ArrowRightLeft, Goal } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { LocalDateTime } from "@/components/ui/relative-time";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildWatchlistDigest, type DigestEvent } from "@/lib/football/watchlist-digest";

/**
 * KIVO_NEXT_GEN KN-106: the reason to come back to a watchlist.
 *
 * `/saved` is a list of rows you added, in the order you added them. Nothing on
 * it ever changes, so there is no reason to open it twice. This is what changes:
 * real `fixture_events` naming a player you watch, real finished results for a
 * team you watch, real `transfers` involving either.
 *
 * Everything here is a thing that demonstrably happened, ordered by when it
 * happened. There is no ranking, no relevance score, no "you might have missed"
 * — KIVO has no view-tracking of any kind, so "missed" would be a fabricated
 * claim about the reader, in a section whose whole value is that it isn't.
 */
export async function WatchlistDigestPanel({ profileId }: { profileId: string }) {
  const digest = await buildWatchlistDigest(createServerSupabaseClient(), profileId);
  const watchedTotal = digest.watchedPlayerCount + digest.watchedTeamCount;

  // Nothing watched at all is not this panel's story to tell — the page's own
  // empty state already covers it, and a second empty box would just be noise.
  if (watchedTotal === 0) return null;

  return (
    <FadeIn delay={0.03} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Since you last looked</h2>
        <p className="text-xs text-foreground-subtle">
          Real match events, results and transfers for the{" "}
          {digest.watchedPlayerCount > 0 && (
            <>
              {digest.watchedPlayerCount} {digest.watchedPlayerCount === 1 ? "player" : "players"}
            </>
          )}
          {digest.watchedPlayerCount > 0 && digest.watchedTeamCount > 0 ? " and " : ""}
          {digest.watchedTeamCount > 0 && (
            <>
              {digest.watchedTeamCount} {digest.watchedTeamCount === 1 ? "team" : "teams"}
            </>
          )}{" "}
          you follow or have saved — matches from the last {digest.eventWindowDays} days, transfers from the last{" "}
          {digest.transferWindowDays}.
        </p>
      </div>

      {digest.events.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          Nothing has happened to them in that window that KIVO has synced. This is a real answer, not a loading
          state — if a match was played but its details haven&apos;t been synced yet, it won&apos;t appear here.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-hairline-soft">
          {digest.events.map((event) => (
            <li key={event.id}>
              <Link
                href={event.href}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <DigestIcon kind={event.kind} />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{event.text}</span>
                <LocalDateTime iso={event.at} format="dayTime" className="shrink-0 text-[11px] text-foreground-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {digest.watchlistTruncated && (
        <p className="text-[11px] text-foreground-subtle">
          You watch more players or teams than this digest covers in one pass — only the first are included.
        </p>
      )}
    </FadeIn>
  );
}

function DigestIcon({ kind }: { kind: DigestEvent["kind"] }) {
  const className = "h-4 w-4 shrink-0 text-foreground-subtle";
  if (kind === "transfer") return <ArrowRightLeft className={className} strokeWidth={1.75} />;
  if (kind === "team_result") return <Activity className={className} strokeWidth={1.75} />;
  return <Goal className={className} strokeWidth={1.75} />;
}
