"use client";

import { useState, useTransition } from "react";
import { updateDisplayName } from "@/app/(app)/profile/actions";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";

/** Mirrors `profiles_display_name_length` (migration 0065) and the same cap in
 * the server action — the field simply cannot hold more than the column will. */
const MAX_DISPLAY_NAME_LENGTH = 40;

export function NameEditor({ displayName }: { displayName: string | null }) {
  const [value, setValue] = useState(displayName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const trimmed = value.trim();
  const unchanged = trimmed === (displayName ?? "").trim();

  return (
    <form
      className="flex flex-col gap-5"
      action={() => {
        setError(null);
        startTransition(async () => {
          const result = await updateDisplayName(trimmed);
          if (result.error) setError(result.error);
          else setSaved(true);
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="display-name" className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Your name
        </label>
        <input
          id="display-name"
          name="display_name"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          maxLength={MAX_DISPLAY_NAME_LENGTH}
          autoFocus
          autoComplete="name"
          placeholder="The name other fans see"
          className="kivo-field w-full px-4 py-3 text-base outline-none"
        />
        <div className="flex items-center justify-between px-1">
          <p className="text-[11px] text-foreground-subtle">
            Shown above your handle. Leave it empty to go by @handle alone.
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-foreground-subtle">
            {trimmed.length}/{MAX_DISPLAY_NAME_LENGTH}
          </span>
        </div>
      </div>

      <ProfileSaveBar pending={pending} disabled={unchanged} saved={saved} error={error} label="Save name" />
    </form>
  );
}
