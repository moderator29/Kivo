"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, Search } from "lucide-react";
import { updateCountry } from "@/app/(app)/profile/actions";
import { getSortedCountries } from "@/lib/countries";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";

/**
 * A filterable list rather than a `<select>`: the list is long enough that a
 * native picker on a phone is a scroll wheel through two hundred options, and
 * the "prefer not to say" answer deserves to be a visible row you can choose
 * rather than the blank first entry of a dropdown.
 *
 * Filtering is client-side here, unlike the club picker's server search — this
 * list is a fixed, small constant compiled into the bundle (`COUNTRY_CODES`),
 * not a table that grows.
 */
export function CountryEditor({ country }: { country: string | null }) {
  const countries = useMemo(() => getSortedCountries(), []);
  const [selected, setSelected] = useState<string | null>(country);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return countries;
    return countries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [countries, query]);

  return (
    <form
      className="flex flex-col gap-5"
      action={() => {
        setError(null);
        startTransition(async () => {
          const result = await updateCountry(selected);
          if (result.error) setError(result.error);
          else setSaved(true);
        });
      }}
    >
      <div className="kivo-field flex items-center gap-2 px-3.5 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-foreground-subtle" strokeWidth={1.75} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search countries"
          aria-label="Search countries"
          className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-subtle"
        />
      </div>

      <div className="kivo-glass flex max-h-[52vh] flex-col divide-y divide-hairline-soft overflow-y-auto overflow-x-hidden rounded-2xl">
        <CountryOption
          label="Prefer not to say"
          muted
          selected={selected === null}
          onSelect={() => {
            setSelected(null);
            setSaved(false);
          }}
        />
        {filtered.map((entry) => (
          <CountryOption
            key={entry.code}
            label={entry.name}
            selected={selected === entry.code}
            onSelect={() => {
              setSelected(entry.code);
              setSaved(false);
            }}
          />
        ))}
        {filtered.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-foreground-subtle">
            No country matches “{query.trim()}”.
          </p>
        )}
      </div>

      <ProfileSaveBar
        pending={pending}
        disabled={selected === country}
        saved={saved}
        error={error}
        label="Save country"
      />
    </form>
  );
}

function CountryOption({
  label,
  selected,
  muted = false,
  onSelect,
}: {
  label: string;
  selected: boolean;
  muted?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="kivo-focus flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-1"
    >
      <span className={`min-w-0 flex-1 truncate text-sm ${muted ? "text-foreground-muted" : "text-foreground"}`}>
        {label}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />}
    </button>
  );
}
