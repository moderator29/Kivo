"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { TeamCrest } from "@/components/ui/team-crest";
import { FixtureStatusBadge } from "@/components/matches/fixture-status-badge";
import { LocalDateTime } from "@/components/ui/relative-time";
import type { AttachableMatch } from "@/app/(app)/social/compose/matches";
import { cn } from "@/lib/utils";

/**
 * Attaching the match a post is about.
 *
 * The founder's line for this layer is that a post about a match should carry
 * that match. `posts.fixture_id` has always been able to hold it and
 * `PostEntityCard` has always been able to draw it — the only missing piece
 * was a way for a fan writing outside a Match Room to say which match they
 * mean. This is that piece, and it is deliberately the *first* control in the
 * composer rather than an afterthought below the text: on KIVO the subject
 * comes before the take.
 *
 * The picker never invents a fixture. Everything in it is a row from
 * `fixtures` whose Room genuinely accepts posts (see
 * `fetchAttachableMatches`), so nothing offered here can be refused by the
 * database after the fan has finished typing.
 *
 * Optional by design. Plenty of football talk is not about one match — a
 * transfer, a manager, a league table — and a composer that demanded a fixture
 * would push those posts into whatever match happened to be nearest.
 */
export function MatchAttachPicker({
  matches,
  failed,
  selected,
  onSelect,
}: {
  matches: AttachableMatch[];
  /** True when the fixture list could not be read. The control says that
   * rather than rendering an empty picker that reads as "no football on". */
  failed: boolean;
  selected: AttachableMatch | null;
  onSelect: (match: AttachableMatch | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => groupMatches(matches, query), [matches, query]);
  const nothingToShow = groups.every((group) => group.matches.length === 0);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
        The match
      </span>

      {selected ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="kivo-focus flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-hairline bg-surface-2 px-3 py-2.5 text-left transition-colors hover:border-hairline-strong"
          >
            <span className="flex shrink-0 items-center -space-x-1.5">
              <TeamCrest crestUrl={selected.homeCrestUrl} name={selected.homeName} size={24} />
              <TeamCrest crestUrl={selected.awayCrestUrl} name={selected.awayName} size={24} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">
                {shortLabel(selected)}
              </span>
              <span className="truncate text-xs text-foreground-subtle">
                {selected.competitionName ?? "Change match"}
              </span>
            </span>
            <FixtureStatusBadge
              status={selected.status}
              kickoffAt={selected.kickoffAt}
              showLiveDot={selected.live}
            />
          </button>
          <button
            type="button"
            onClick={() => onSelect(null)}
            aria-label="Post without a match"
            className="kivo-focus flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-hairline text-foreground-subtle transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      ) : failed ? (
        <p className="rounded-xl border border-hairline bg-surface-2 px-3.5 py-3 text-xs text-foreground-muted">
          KIVO couldn&rsquo;t reach the fixture list just now, so there&rsquo;s no match to pick. Your post still
          goes up — you can write it without one.
        </p>
      ) : matches.length === 0 ? (
        <p className="rounded-xl border border-hairline bg-surface-2 px-3.5 py-3 text-xs text-foreground-muted">
          No match is open for talk right now. Rooms open as soon as a fixture is on the calendar and close a day
          after full time.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="kivo-focus flex min-h-12 items-center gap-2.5 rounded-xl border border-dashed border-hairline-strong px-3.5 py-2.5 text-left text-sm text-foreground-muted transition-colors hover:bg-surface-2"
        >
          <BallGlyph className="h-4 w-4 shrink-0 text-foreground-subtle" />
          Which match is this about?
          <span className="ml-auto shrink-0 text-xs text-foreground-subtle">Optional</span>
        </button>
      )}

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Pick the match"
        description="Your post shows up in this match's room, and carries the fixture wherever it appears."
      >
        <div className="flex flex-col gap-4">
          <label className="kivo-field flex min-h-12 items-center gap-2.5 rounded-xl px-3.5">
            <Search className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Club or competition"
              className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-foreground placeholder:text-foreground-subtle focus:outline-none"
            />
            <span className="sr-only">Search matches</span>
          </label>

          {nothingToShow ? (
            <p className="py-6 text-center text-sm text-foreground-muted">
              No match here matches &ldquo;{query.trim()}&rdquo;. Try a club&rsquo;s name.
            </p>
          ) : (
            groups.map((group) =>
              group.matches.length === 0 ? null : (
                <section key={group.id} className="flex flex-col gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
                    {group.title}
                  </h3>
                  {/* One container, hairline dividers — not one box per match.
                      DENSITY_RULES: stacked boxes are what makes a list look
                      cluttered, and this list is long by nature. */}
                  <ul className="overflow-hidden rounded-xl border border-hairline">
                    {group.matches.map((match, index) => (
                      <li key={match.id} className={index === 0 ? "" : "border-t border-hairline-soft"}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(match);
                            setOpen(false);
                            setQuery("");
                          }}
                          className={cn(
                            "kivo-focus flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2",
                            match.id === selected?.id && "bg-accent-soft",
                          )}
                        >
                          <span className="flex shrink-0 items-center -space-x-1.5">
                            <TeamCrest crestUrl={match.homeCrestUrl} name={match.homeName} size={24} />
                            <TeamCrest crestUrl={match.awayCrestUrl} name={match.awayName} size={24} />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium text-foreground">
                              {shortLabel(match)}
                            </span>
                            <span className="truncate text-xs text-foreground-subtle">
                              {match.competitionName ? `${match.competitionName} · ` : ""}
                              <LocalDateTime iso={match.kickoffAt} format="dayTime" />
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {match.homeScore !== null && match.awayScore !== null && (
                              <span
                                className={cn(
                                  "text-sm font-semibold tabular-nums",
                                  match.live ? "text-live" : "text-foreground",
                                )}
                              >
                                {match.homeScore}&ndash;{match.awayScore}
                              </span>
                            )}
                            <FixtureStatusBadge
                              status={match.status}
                              kickoffAt={match.kickoffAt}
                              showLiveDot={match.live}
                            />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            )
          )}
        </div>
      </BottomSheet>
    </div>
  );
}

/** The scoreboard shorthand, falling back to the full name when a club has no
 * short name recorded. Never an abbreviation KIVO invented. */
function shortLabel(match: AttachableMatch): string {
  return `${match.homeShortName || match.homeName} v ${match.awayShortName || match.awayName}`;
}

type MatchGroup = { id: string; title: string; matches: AttachableMatch[] };

/**
 * Three groupings, each of which is a fact rather than a ranking: a match is
 * in play or it is not, a club is one this fan follows or it is not, and
 * kickoff time is kickoff time. Every match appears exactly once, in the
 * first group it qualifies for.
 */
function groupMatches(matches: AttachableMatch[], query: string): MatchGroup[] {
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? matches.filter((match) =>
        [
          match.homeName,
          match.homeShortName,
          match.awayName,
          match.awayShortName,
          match.competitionName,
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(needle)),
      )
    : matches;

  const live: AttachableMatch[] = [];
  const yours: AttachableMatch[] = [];
  const rest: AttachableMatch[] = [];
  for (const match of visible) {
    if (match.live) live.push(match);
    else if (match.yours) yours.push(match);
    else rest.push(match);
  }

  return [
    { id: "live", title: "In play right now", matches: live },
    { id: "yours", title: "Your clubs", matches: yours },
    { id: "rest", title: yours.length > 0 || live.length > 0 ? "Everything else" : "Coming up", matches: rest },
  ];
}

/** A ball, drawn rather than imported: lucide has no football, and the empty
 * control is the one place in the composer that should look like this app is
 * about football before a single word is typed. */
function BallGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeLinecap="round" />
      <path d="M12 7.5 8.6 10l1.3 4h4.2l1.3-4z" strokeLinejoin="round" />
      <path d="M12 3v4.5M8.6 10 4.3 8.6M9.9 14l-2.6 3.6M14.1 14l2.6 3.6M15.4 10l4.3-1.4" strokeLinecap="round" />
    </svg>
  );
}
