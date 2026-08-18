"use client";

import { useState, useTransition } from "react";
import { updateBio } from "@/app/(app)/profile/actions";
import { ProfileSaveBar } from "@/components/profile/profile-save-bar";

/** Mirrors `profiles_bio_length` (migration 0001) and the same cap in the
 * server action and in Settings' own editor. */
const MAX_BIO_LENGTH = 500;

export function BioEditor({ bio }: { bio: string | null }) {
  const [value, setValue] = useState(bio ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const trimmed = value.trim();
  const unchanged = trimmed === (bio ?? "").trim();
  const remaining = MAX_BIO_LENGTH - trimmed.length;

  return (
    <form
      className="flex flex-col gap-5"
      action={() => {
        setError(null);
        startTransition(async () => {
          const result = await updateBio(trimmed);
          if (result.error) setError(result.error);
          else setSaved(true);
        });
      }}
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="bio" className="px-1 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
          Your bio
        </label>
        <textarea
          id="bio"
          name="bio"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setSaved(false);
          }}
          maxLength={MAX_BIO_LENGTH}
          rows={6}
          autoFocus
          placeholder="Who you support, what you watch for, where you watch from."
          className="kivo-field w-full resize-none px-4 py-3 text-base leading-relaxed outline-none"
        />
        <div className="flex items-center justify-between px-1">
          <p className="text-[11px] text-foreground-subtle">Line breaks are kept exactly as you type them.</p>
          <span
            className={`shrink-0 text-[11px] tabular-nums ${remaining < 40 ? "text-warning" : "text-foreground-subtle"}`}
          >
            {remaining}
          </span>
        </div>
      </div>

      <ProfileSaveBar pending={pending} disabled={unchanged} saved={saved} error={error} label="Save bio" />
    </form>
  );
}
