"use client";

import { useState, useTransition } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { updateActivityVisibility } from "@/app/(app)/settings/actions";

/**
 * RECOMMENDATIONS.md item 286: the one real privacy control this account has
 * over what a public visitor sees on /u/[username] — same optimistic-toggle
 * shape as NotificationPreferencesPanel (revert on error, no separate "Save"
 * step), just a single row instead of a list.
 */
export function ActivityPrivacyToggle({ initialShowActivityPublicly }: { initialShowActivityPublicly: boolean }) {
  const [showActivityPublicly, setShowActivityPublicly] = useState(initialShowActivityPublicly);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const previous = showActivityPublicly;
    const next = !previous;

    setError(null);
    setShowActivityPublicly(next);

    startTransition(async () => {
      const result = await updateActivityVisibility(next);
      if (result.error) {
        setShowActivityPublicly(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">Show your XP and badges on your public profile</span>
          <span className="text-xs text-foreground-subtle">
            When off, visitors to your @username page see that your activity is private instead of your real XP and
            badges.
          </span>
        </div>
        <ToggleSwitch
          checked={showActivityPublicly}
          disabled={pending}
          onChange={handleToggle}
          label="Show your XP and badges on your public profile"
        />
      </div>
      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
