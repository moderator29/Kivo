"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Search, ShieldHalf, Users } from "lucide-react";
import { searchTeams, updateFavouriteTeam } from "@/app/(app)/profile/actions";
import { TeamCrest } from "@/components/ui/team-crest";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";
import { useSaveReturn } from "@/hooks/use-save-return";
import { ClubFilterSheet } from "@/components/profile/club-filter-sheet";
import { LoadFailed } from "@/components/ui/load-failed";
import { TEAM_PICKER_LIMIT, type PickerFacets, type PickerTeam } from "@/lib/profile-picker";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * "Change the club you support" — the surface that did not exist. Onboarding
 * asked once, `profiles.favourite_team_id` recorded the answer, and there was
 * no way to change it afterwards short of an account reset.
 *
 * One club, enforced by the schema rather than by this component:
 * `favourite_team_id` is a single nullable FK, so a second club is not
 * something the UI has to refuse — it is not expressible. That is deliberately
 * different from *following* clubs, which is a many-to-many `follows`
 * relationship with no limit; the copy on this page says so, because the two
 * are easy to confuse and they drive different things (this one personalises
 * /home and the AI's grounding, follows drive alerts).
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * The founder's report: the picker offered clubs nobody had heard of. Two
 * causes, and this component owns the second.
 *
 * The first is the pipeline — the database held 705 clubs because one day of
 * fixtures created them, so Real Madrid was absent for having not played on a
 * Tuesday. That is migration 0107 and the catalogue sync, and it is somebody
 * else's fix.
 *
 * The second is that this screen was a `limit 40 order by name` with a
 * substring search bolted on. Whatever the pipeline puts in the table, the
 * first forty rows alphabetically are reserve sides and youth teams, and a
 * user whose club was two hundred rows down had no way to tell it was there.
 * So this now has:
 *
 * - **real search**, server-side, over the club's name *and* its short name,
 *   so "Man Utd" finds "Manchester United";
 * - **an order**, from `search_clubs_ranked`: how many KIVO profiles follow
 *   the club, then the alphabet. One real count, no invented prominence — see
 *   migration 0108 for why there is deliberately no second signal and why a
 *   hand-written list of "big clubs" would be an opinion wearing a
 *   measurement's clothes;
 * - **narrowing by competition and by country**, each offered only when there
 *   is real data behind it. `teams.country` is null on every synced row today,
 *   so the country control is legitimately absent rather than empty.
 */
export function ClubChoice({
  initialTeams,
  initialRanked,
  facets,
  currentTeamId,
  loadFailed = false,
}: {
  initialTeams: PickerTeam[];
  /** Whether `initialTeams` came back ordered by `search_clubs_ranked`. False
   * means the fallback alphabetical read ran, and the copy under the search
   * box says so instead of claiming an order the list does not have. */
  initialRanked: boolean;
  facets: PickerFacets;
  currentTeamId: string | null;
  /** The opening read failed outright. "KIVO could not look" is a different
   * fact from "there are no clubs", and this screen tells them apart. */
  loadFailed?: boolean;
}) {
  const router = useRouter();
  const [teams, setTeams] = useState(initialTeams);
  const [ranked, setRanked] = useState(initialRanked);
  const [failed, setFailed] = useState(loadFailed);
  const [query, setQuery] = useState("");
  const [competitionKey, setCompetitionKey] = useState<string | null>(null);
  const [countryKey, setCountryKey] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(currentTeamId);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  // The founder's ask: a save ends the errand. See useSaveReturn — the
  // destination is the one the back control names, and the control stays.
  const returnToCaller = useSaveReturn();

  const requestId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The filters the list currently on screen was built with. Starts at
   * "neither", because that is what the server render used.
   *
   * Compared by VALUE rather than by "have I run before", and the difference
   * is not academic: React runs effects twice on mount in development, so a
   * first-run flag lets the second invocation fire a redundant request that
   * replaces a correct server-rendered list with a client-fetched one — which
   * is exactly what it did, and what showed an empty list under a filter
   * nobody had set. A value comparison is idempotent however many times the
   * effect runs.
   */
  const appliedFilters = useRef<{ competitionId: string | null; country: string | null }>({
    competitionId: null,
    country: null,
  });

  const run = useCallback((nextQuery: string, competitionId: string | null, country: string | null) => {
    const id = ++requestId.current;
    setSearching(true);
    searchTeams(nextQuery, { competitionId, country })
      .then((result) => {
        // Out-of-order responses are dropped rather than rendered: with a
        // 300ms debounce over a network, a slow "man" can land after a fast
        // "manchester" and overwrite it.
        if (requestId.current !== id) return;
        setTeams(result.teams);
        setRanked(result.ranked);
        setFailed(result.failed);
        setSearching(false);
      })
      .catch(() => {
        if (requestId.current !== id) return;
        setTeams([]);
        setFailed(true);
        setSearching(false);
      });
  }, []);

  // Filter changes take effect immediately (a tap is a deliberate act, not a
  // keystroke in progress); typing is debounced.
  useEffect(() => {
    if (
      appliedFilters.current.competitionId === competitionKey &&
      appliedFilters.current.country === countryKey
    ) {
      return;
    }
    appliedFilters.current = { competitionId: competitionKey, country: countryKey };
    run(query, competitionKey, countryKey);
    // `query` is deliberately absent: typing is handled by handleQuery's own
    // debounce, and including it here would fire a second, undebounced request
    // on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionKey, countryKey, run]);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  function handleQuery(next: string) {
    setQuery(next);
    if (debounce.current) clearTimeout(debounce.current);
    setSearching(true);
    debounce.current = setTimeout(() => run(next, competitionKey, countryKey), SEARCH_DEBOUNCE_MS);
  }

  const trimmedQuery = query.trim();
  const filtered = competitionKey !== null || countryKey !== null;
  const narrowed = trimmedQuery !== "" || filtered;

  if (failed) {
    return (
      <LoadFailed
        tone="section"
        title="Clubs"
        description="KIVO couldn't read its club list just now. That's not the same as there being no clubs — try again."
      />
    );
  }

  // Nothing synced yet is a real state of this project, not a bug: the
  // football tables are empty until a provider key is configured and a sync
  // has run. Say that, rather than render a search box over an empty table.
  if (initialTeams.length === 0 && !narrowed && teams.length === 0) {
    return (
      <div className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center">
        <ShieldHalf className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
        <p className="text-sm font-semibold text-foreground">No clubs yet</p>
        <p className="max-w-xs text-xs leading-relaxed text-foreground-muted">
          There are no clubs to choose from just yet. Once competitions are
          live this is where you pick the one you support.
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      action={() => {
        setError(null);
        startTransition(async () => {
          const result = await updateFavouriteTeam(selected);
          if (result.error) setError(result.error);
          else {
            setSaved(true);
            router.refresh();
            returnToCaller();
          }
        });
      }}
    >
      <div className="kivo-field flex items-center gap-2 px-3.5 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(event) => handleQuery(event.target.value)}
          placeholder="Search clubs"
          aria-label="Search clubs"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle"
        />
        {searching && (
          <span className="block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-foreground-subtle/30 border-t-foreground-subtle" />
        )}
      </div>

      {(facets.competitions.length > 1 || facets.countries.length > 1) && (
        <div className="flex flex-wrap items-center gap-2">
          <ClubFilterSheet
            label="Competition"
            title="Competition"
            description="Narrows the list to clubs KIVO has football for in one competition."
            options={facets.competitions}
            selectedKey={competitionKey}
            onSelect={setCompetitionKey}
            allLabel="All competitions"
          />
          {/* Absent, not empty, while `teams.country` is null on every synced
              row — a control that can only ever produce an empty list is a
              promise the data cannot keep. */}
          <ClubFilterSheet
            label="Country"
            title="Country"
            description="Narrows the list to clubs KIVO records in one country."
            options={facets.countries}
            selectedKey={countryKey}
            onSelect={setCountryKey}
            allLabel="All countries"
          />
          {filtered && (
            <button
              type="button"
              onClick={() => {
                setCompetitionKey(null);
                setCountryKey(null);
              }}
              className="kivo-focus min-h-11 rounded-xl px-2 text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* What the order actually is, said plainly. KIVO has no popularity data
          and this list does not pretend otherwise: the only signal is a real
          count of KIVO profiles following each club. */}
      <p className="text-[11px] leading-relaxed text-foreground-subtle">
        {ranked
          ? "Clubs other KIVO fans follow come first, then A–Z. KIVO has no “big club” list — this order is real follow counts and nothing else."
          : "Listed A–Z. KIVO couldn’t read follow counts this time, so nothing is ordered ahead of anything else."}
        {teams.length >= TEAM_PICKER_LIMIT && ` Showing the first ${TEAM_PICKER_LIMIT} — search to narrow it down.`}
      </p>

      <div className="kivo-glass flex max-h-[52vh] flex-col divide-y divide-hairline-soft overflow-y-auto overflow-x-hidden rounded-2xl">
        <button
          type="button"
          onClick={() => {
            setSelected(null);
            setSaved(false);
          }}
          aria-pressed={selected === null}
          className="kivo-focus flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-1"
        >
          <ShieldHalf className="h-5 w-5 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground-muted">No club</span>
          {selected === null && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />}
        </button>

        {teams.map((team) => {
          const isActive = selected === team.id;
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => {
                setSelected(team.id);
                setSaved(false);
              }}
              aria-pressed={isActive}
              className="kivo-focus flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-1"
            >
              <TeamCrest crestUrl={team.crest_url} name={team.name} size={24} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{team.name}</span>
                <span className="flex min-w-0 items-center gap-2 text-[11px] text-foreground-subtle">
                  {team.country && <span className="truncate">{team.country}</span>}
                  {/* Only above zero. "0 followers" on every row of a young
                      product is noise, and it reads as a verdict on the club
                      rather than on KIVO's age. */}
                  {team.follower_count > 0 && (
                    <span className="flex shrink-0 items-center gap-1">
                      <Users className="h-3 w-3" strokeWidth={2} />
                      {team.follower_count}
                    </span>
                  )}
                </span>
              </span>
              {isActive && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />}
            </button>
          );
        })}

        {teams.length === 0 && (
          <p className="px-4 py-6 text-center text-xs leading-relaxed text-foreground-subtle">
            {trimmedQuery
              ? `No club matches “${trimmedQuery}”${filtered ? " with these filters" : ""}.`
              : filtered
                ? "No clubs match these filters."
                : "KIVO has no clubs to show here."}
            {filtered && " Clearing the filters searches every club KIVO has."}
          </p>
        )}
      </div>

      <ProfileSaveBar
        pending={pending}
        disabled={selected === currentTeamId}
        saved={saved}
        error={error}
        label="Save club"
      />
    </form>
  );
}
