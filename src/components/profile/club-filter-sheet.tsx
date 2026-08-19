"use client";

import { useMemo, useState } from "react";
import { Check, ListFilter, Search } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { PickerFacet } from "@/lib/profile-picker";
import { cn } from "@/lib/utils";

/**
 * One narrowing control for the club picker: competition, or country.
 *
 * Deliberately not `CompetitionFilter` (src/components/matches/), which this
 * otherwise resembles. That one narrows a list of fixtures already on screen,
 * so its options are a handful and it can afford to render all of them. This
 * one narrows a table: the live database has 85 competitions today and the
 * club catalogue is built to grow that, so the sheet needs its own search or
 * it is a scroll rather than a choice.
 *
 * Every option carries a real club count from `club_picker_facets`, and the
 * control does not render at all when there is nothing to choose between —
 * see `PickerFacets` for why an empty country facet is the expected state
 * rather than a bug.
 */
export function ClubFilterSheet({
  label,
  title,
  description,
  options,
  selectedKey,
  onSelect,
  allLabel,
}: {
  /** What the trigger says when nothing is selected: "Competition", "Country". */
  label: string;
  title: string;
  description: string;
  options: PickerFacet[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  /** The "no narrowing" row: "All competitions", "All countries". */
  allLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((option) => option.key === selectedKey) ?? null;

  // Filtering the options list is a plain substring match over data already in
  // the browser — these are at most a few hundred short labels, so a round
  // trip per keystroke would be slower and no more correct.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  // One option is not a choice between options: the sheet's two rows would
  // produce the same list.
  if (options.length < 2) return null;

  function choose(key: string | null) {
    onSelect(key);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "kivo-glass-sharp kivo-focus flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition-colors",
          selected ? "text-foreground" : "text-foreground-muted hover:text-foreground",
        )}
      >
        <ListFilter className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span className="min-w-0 truncate">{selected ? selected.label : label}</span>
        {selected && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={title} description={description}>
        <div className="flex flex-col gap-3">
          <div className="kivo-field flex items-center gap-2 px-3.5 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              aria-label={`Search ${label.toLowerCase()}`}
              className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle"
            />
          </div>

          <ul className="flex flex-col gap-1.5">
            <li>
              <FilterRow selected={selectedKey === null} label={allLabel} onClick={() => choose(null)} />
            </li>
            {visible.map((option) => (
              <li key={option.key}>
                <FilterRow
                  selected={option.key === selectedKey}
                  label={option.label}
                  count={option.clubCount}
                  onClick={() => choose(option.key)}
                />
              </li>
            ))}
          </ul>

          {visible.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-foreground-subtle">
              Nothing here matches “{query.trim()}”.
            </p>
          )}
        </div>
      </BottomSheet>
    </>
  );
}

/**
 * The selected state carries three cues rather than one — border, wash and a
 * trailing mark — because a border alone is the cue that disappears first for
 * anyone with a contrast or colour-vision difference, and this row decides
 * what the whole list below it shows.
 */
function FilterRow({
  selected,
  label,
  count,
  onClick,
}: {
  selected: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "kivo-focus flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
        selected ? "border-accent/60 bg-accent/10" : "border-transparent hover:bg-surface-2",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-[11px] text-foreground-subtle">
          {count} {count === 1 ? "club" : "clubs"}
        </span>
      )}
      {selected && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />}
    </button>
  );
}
