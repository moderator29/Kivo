"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Pencil, Check, X } from "lucide-react";
import { updateProfileDetails } from "@/app/(app)/settings/actions";
import { getSortedCountries } from "@/lib/countries";

const MAX_BIO_LENGTH = 500;

export function ProfileDetailsEditor({ bio, country }: { bio: string | null; country: string | null }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [bioLength, setBioLength] = useState(bio?.length ?? 0);

  const countries = useMemo(() => getSortedCountries(), []);

  useEffect(() => {
    if (!justSaved) return;
    const timeout = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(timeout);
  }, [justSaved]);

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-foreground-subtle">Bio</span>
            <p className="text-sm text-foreground">{bio || <span className="text-foreground-subtle">No bio yet.</span>}</p>
          </div>
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit profile details"
            className="shrink-0 text-foreground-muted transition-colors hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex flex-col gap-1 border-t border-white/5 pt-3">
          <span className="text-xs text-foreground-subtle">Country</span>
          <p className="text-sm text-foreground">
            {country ? countries.find((c) => c.code === country)?.name ?? country : <span className="text-foreground-subtle">Not set.</span>}
          </p>
        </div>
        <AnimatePresence>
          {justSaved && (
            <motion.span
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex w-fit items-center gap-1 text-xs font-medium text-live"
            >
              <Check className="h-3 w-3" strokeWidth={2.5} />
              Saved
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await updateProfileDetails(formData);
          if (result.error) setError(result.error);
          else {
            setEditing(false);
            setJustSaved(true);
          }
        });
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bio" className="text-xs text-foreground-subtle">
          Bio
        </label>
        <textarea
          id="bio"
          name="bio"
          defaultValue={bio ?? ""}
          maxLength={MAX_BIO_LENGTH}
          rows={3}
          autoFocus
          onChange={(e) => setBioLength(e.target.value.length)}
          placeholder="Tell other fans about yourself"
          className="resize-none rounded-lg border border-white/10 bg-kivo-obsidian px-3 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-kivo-blue focus:outline-none"
        />
        <span className="self-end text-[11px] text-foreground-subtle">
          {bioLength}/{MAX_BIO_LENGTH}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="country" className="text-xs text-foreground-subtle">
          Country
        </label>
        <select
          id="country"
          name="country"
          defaultValue={country ?? ""}
          className="rounded-lg border border-white/10 bg-kivo-obsidian px-3 py-2 text-sm text-foreground focus:border-kivo-blue focus:outline-none"
        >
          <option value="">Not set</option>
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <span className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </span>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="kivo-gradient-prime flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-kivo-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setEditing(false)}
          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
          Cancel
        </button>
      </div>
    </form>
  );
}
