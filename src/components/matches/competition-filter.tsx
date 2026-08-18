"use client";

import { useState } from "react";
import { ListFilter, Check } from "lucide-react";
import { CompetitionLogo } from "@/components/ui/competition-logo";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils";

export type CompetitionFilterOption = {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  /** How many fixtures in the list this filter is over. A real count of rows
   * already on the page — never an estimate, and never a total from anywhere
   * else. */
  count: number;
};

/**
 * Filtering a fixture list by competition.
 *
 * `/matches` and `/live` both group by competition already
 * (`groupFixturesByCompetition`) and neither had any way to *narrow* to one —
 * on a full Saturday that is a page of eight leagues you scroll past to find
 * the one you follow. This is the surface that was missing, not a new
 * arrangement of the one that exists.
 *
 * Every row is real data: a competition that has fixtures in the list being
 * filtered, its own crest from `competitions.logo_url`, and a count of the
 * rows it would leave on screen. A competition with nothing on this day is
 * not offered, because a filter that can only ever produce an empty list is
 * not a choice.
 *
 * The "All" row leads with the crests it stands for rather than a generic
 * glyph — at a glance it says which competitions today's list actually spans,
 * which is information the trigger button alone cannot carry.
 */
export function CompetitionFilter({
  options,
  selectedId,
  onSelect,
  totalCount,
  className,
}: {
  options: CompetitionFilterOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  totalCount: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === selectedId) ?? null;

  // One competition is not a choice between competitions. The trigger would
  // open a sheet whose only two rows produce the same list.
  if (options.length < 2) return null;

  function choose(id: string | null) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "kivo-glass-sharp kivo-focus flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-colors",
          selected ? "text-foreground" : "text-foreground-muted hover:text-foreground",
          className,
        )}
      >
        {selected ? (
          <CompetitionLogo logoUrl={selected.logoUrl} name={selected.name} size={16} />
        ) : (
          <ListFilter className="h-3.5 w-3.5" strokeWidth={2} />
        )}
        <span className="max-w-[9rem] truncate">{selected ? selected.shortName || selected.name : "Filter"}</span>
        {selected && (
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        )}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Competition"
        description="Narrows the list below. Only competitions with fixtures here are listed."
      >
        <ul className="flex flex-col gap-1.5">
          <li>
            <FilterRow
              selected={selectedId === null}
              label="All competitions"
              count={totalCount}
              onClick={() => choose(null)}
              leading={<StackedCrests options={options} />}
            />
          </li>
          {options.map((option) => (
            <li key={option.id}>
              <FilterRow
                selected={option.id === selectedId}
                label={option.name}
                count={option.count}
                onClick={() => choose(option.id)}
                leading={
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
                    <CompetitionLogo logoUrl={option.logoUrl} name={option.name} size={22} />
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      </BottomSheet>
    </>
  );
}

/** The crests the "All" row stands for, overlapped. Capped at three plus a
 * remainder count: four was measured at 390px and left the row's own label
 * truncating, and a stack that costs the row its name is decoration. */
function StackedCrests({ options }: { options: CompetitionFilterOption[] }) {
  const shown = options.slice(0, 3);
  const remainder = options.length - shown.length;
  return (
    <span className="flex shrink-0 items-center">
      <span className="flex items-center -space-x-2">
        {shown.map((option) => (
          <span
            key={option.id}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-hairline bg-surface-3"
          >
            <CompetitionLogo logoUrl={option.logoUrl} name={option.name} size={20} />
          </span>
        ))}
      </span>
      {remainder > 0 && (
        <span className="ml-1.5 text-[11px] font-semibold text-foreground-subtle">+{remainder}</span>
      )}
    </span>
  );
}

/**
 * One row. The selected state carries three cues, not one: an accent border,
 * an accent wash, and a trailing mark — because a border alone is the cue that
 * disappears first for anyone with a contrast or colour-vision difference, and
 * this row is how the whole page below it is being read.
 */
function FilterRow({
  selected,
  label,
  count,
  leading,
  onClick,
}: {
  selected: boolean;
  label: string;
  count: number;
  leading: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "kivo-focus flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-accent bg-accent-soft"
          : "border-hairline hover:border-hairline-strong hover:bg-surface-2",
      )}
    >
      {leading}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold text-foreground">{label}</span>
        <span className="text-[11px] text-foreground-subtle">
          {count} {count === 1 ? "fixture" : "fixtures"}
        </span>
      </span>
      {selected ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-strong">
          <Check className="h-3 w-3 text-on-accent" strokeWidth={2} />
        </span>
      ) : (
        <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border border-hairline" />
      )}
    </button>
  );
}
