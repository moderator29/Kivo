"use client";

import { useState, useTransition } from "react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { updateNotificationPreference } from "@/app/(app)/settings/actions";
import type { NotificationPreferenceColumn } from "@/lib/notification-preferences";

const PREFERENCE_ROWS: { column: NotificationPreferenceColumn; label: string; description: string }[] = [
  { column: "match_alerts_enabled", label: "Match alerts", description: "Kickoff, goals and full-time for teams you follow." },
  { column: "prediction_alerts_enabled", label: "Prediction alerts", description: "Results and leaderboard movement for your predictions." },
  { column: "fantasy_alerts_enabled", label: "Fantasy alerts", description: "Gameweek deadlines and fantasy team news." },
  { column: "social_alerts_enabled", label: "Social alerts", description: "Likes, comments and new followers." },
  { column: "in_app_enabled", label: "In-app notifications", description: "Show notifications inside KIVO." },
  { column: "push_enabled", label: "Push notifications", description: "Alerts sent to this device." },
  { column: "email_enabled", label: "Email notifications", description: "Account and activity emails from KIVO." },
  { column: "marketing_emails_enabled", label: "Marketing emails", description: "Promotions, offers and KIVO news." },
];

export function NotificationPreferencesPanel({
  initial,
}: {
  initial: Record<NotificationPreferenceColumn, boolean>;
}) {
  const [values, setValues] = useState(initial);
  const [pendingColumn, setPendingColumn] = useState<NotificationPreferenceColumn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleToggle(column: NotificationPreferenceColumn) {
    const previous = values[column];
    const next = !previous;

    setError(null);
    setValues((current) => ({ ...current, [column]: next }));
    setPendingColumn(column);

    startTransition(async () => {
      const result = await updateNotificationPreference(column, next);
      if (result.error) {
        setValues((current) => ({ ...current, [column]: previous }));
        setError(result.error);
      }
      setPendingColumn(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {PREFERENCE_ROWS.map((row, index) => (
        <div
          key={row.column}
          className={`flex items-center justify-between gap-4 py-3 ${index > 0 ? "border-t border-white/5" : ""}`}
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-foreground">{row.label}</span>
            <span className="text-xs text-foreground-subtle">{row.description}</span>
          </div>
          <ToggleSwitch
            checked={values[row.column]}
            disabled={pendingColumn === row.column}
            onChange={() => handleToggle(row.column)}
            label={row.label}
          />
        </div>
      ))}
      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
