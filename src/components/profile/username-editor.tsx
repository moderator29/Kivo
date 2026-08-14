"use client";

import { useState, useTransition } from "react";
import { Pencil, Check, X } from "lucide-react";
import { updateUsername } from "@/app/(app)/profile/actions";

export function UsernameEditor({ username }: { username: string }) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        @{username}
        <Pencil className="h-3 w-3" strokeWidth={1.75} />
      </button>
    );
  }

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await updateUsername(formData);
          if (result.error) setError(result.error);
          else setEditing(false);
        });
      }}
      className="flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-1.5">
        <input
          name="username"
          defaultValue={username}
          minLength={3}
          maxLength={24}
          pattern="[a-z0-9_]+"
          autoFocus
          className="rounded-lg border border-white/10 bg-kivo-obsidian px-2 py-1 text-sm text-foreground focus:border-kivo-blue focus:outline-none"
        />
        <button type="submit" disabled={pending} className="text-live disabled:opacity-50" aria-label="Save">
          <Check className="h-4 w-4" strokeWidth={2} />
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-foreground-subtle" aria-label="Cancel">
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {error && <span className="text-xs text-critical">{error}</span>}
    </form>
  );
}
