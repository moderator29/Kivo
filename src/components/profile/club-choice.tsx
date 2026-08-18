"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Search, ShieldHalf } from "lucide-react";
import { searchTeams, updateFavouriteTeam } from "@/app/(app)/profile/actions";
import { TeamCrest } from "@/components/ui/team-crest";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";
import type { PickerTeam } from "@/lib/profile-picker";

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
 */
export function ClubChoice({
  initialTeams,
  currentTeamId,
}: {
  initialTeams: PickerTeam[];
  currentTeamId: string | null;
}) {
  const router = useRouter();
  const [teams, setTeams] = useState(initialTeams);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(currentTeamId);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const requestId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, []);

  function handleQuery(next: string) {
    setQuery(next);
    if (debounce.current) clearTimeout(debounce.current);
    setSearching(true);
    const id = ++requestId.current;
    debounce.current = setTimeout(() => {
      searchTeams(next).then((result) => {
        if (requestId.current !== id) return;
        setTeams(result.teams);
        setSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
  }

  // Nothing synced yet is the live state of this project, not a bug: the
  // football tables are empty until a provider key is configured. Say that,
  // rather than render a search box over an empty table.
  if (initialTeams.length === 0 && query.trim() === "") {
    return (
      <div className="kivo-glass flex flex-col items-center gap-2 rounded-2xl px-6 py-10 text-center">
        <ShieldHalf className="h-6 w-6 text-foreground-subtle" strokeWidth={1.75} />
        <p className="text-sm font-semibold text-foreground">No clubs yet</p>
        <p className="max-w-xs text-xs leading-relaxed text-foreground-muted">
          KIVO has not synced any football data yet, so there are no clubs to choose from. Once competitions are
          live this is where you pick the one you support.
        </p>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-5"
      action={() => {
        setError(null);
        startTransition(async () => {
          const result = await updateFavouriteTeam(selected);
          if (result.error) setError(result.error);
          else {
            setSaved(true);
            router.refresh();
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
                {team.country && (
                  <span className="truncate text-[11px] text-foreground-subtle">{team.country}</span>
                )}
              </span>
              {isActive && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />}
            </button>
          );
        })}

        {teams.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-foreground-subtle">
            No club matches “{query.trim()}”.
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
