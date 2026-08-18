"use client";

import { useState, useTransition } from "react";
import { Download, AlertTriangle, Check } from "lucide-react";
import { exportUserData } from "@/app/(app)/settings/actions";

/**
 * RECOMMENDATIONS.md item 135: settings had notification preferences, bio,
 * country, avatar and account deletion, but no data export — the one piece
 * `exportUserData` (settings/actions.ts) exists to fill. Triggers a real
 * browser file download of the JSON the server action returns; no server
 * route or storage involved, so nothing here is ever persisted beyond this
 * one request/response.
 */
export function DataExportSection({ username }: { username: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleExport() {
    if (pending) return;
    setError(null);
    setDone(false);
    startTransition(async () => {
      const result = await exportUserData();
      if (result.error || !result.data) {
        setError(result.error ?? "Something went wrong. Try again.");
        return;
      }

      // Plain client-side download — a Blob URL clicked via a throwaway
      // anchor, same mechanism as match-share-card.tsx's existing image
      // download. Filename carries the username + an ISO date so repeat
      // exports don't silently overwrite each other in a downloads folder.
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `kivo-data-export-${username}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">Your data</span>
        <span className="text-xs text-foreground-subtle">
          Download your profile, posts, comments, predictions, fantasy teams, follows, saves, badges and XP history
          as a JSON file.
        </span>
      </div>
      <button
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={handleExport}
        className="kivo-glass-sharp flex w-fit items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-foreground transition-transform active:scale-95 disabled:opacity-50"
      >
        <Download className="h-4 w-4" strokeWidth={1.75} />
        {pending ? "Preparing…" : "Download my data"}
      </button>
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-critical" role="status" aria-live="polite">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      )}
      {done && !error && (
        <p className="flex items-center gap-1.5 text-xs text-live" role="status" aria-live="polite">
          <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Downloaded.
        </p>
      )}
    </div>
  );
}
