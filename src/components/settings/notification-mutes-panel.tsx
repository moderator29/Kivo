"use client";

import { useState, useTransition } from "react";
import { Shield, Trophy, User, Users } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { setEntityMuted, type NotifiableEntity } from "@/app/(app)/settings/notification-mute-actions";
import type { MuteTargetType } from "@/lib/notification-mutes";

const ICON: Record<MuteTargetType, typeof Users> = {
  team: Shield,
  player: User,
  competition: Trophy,
};

const GROUP_LABEL: Record<MuteTargetType, string> = {
  team: "Clubs",
  player: "Players",
  competition: "Competitions",
};

const GROUP_ORDER: MuteTargetType[] = ["team", "player", "competition"];

/**
 * "This club, not that one" — the per-entity half of the notification
 * preferences, next to the per-type half rather than a page away from it.
 *
 * The switch reads **on = notifications on**, not "muted on". A settings page
 * where some switches mean yes and others mean no is a page people get wrong,
 * and getting this one wrong means silence they did not ask for.
 *
 * The list is only ever the entities that can actually produce a notification
 * for this person — see `getNotifiableEntities`. A searchable directory of
 * every club in the database would fill this page with switches that change
 * nothing, because KIVO's producers build their audience from a favourite club
 * and the follow graph and nothing else.
 */
export function NotificationMutesPanel({ entities }: { entities: NotifiableEntity[] }) {
  const [state, setState] = useState(entities);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (entities.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-foreground-subtle">
        Nothing to mute yet. Follow a club, a player or a competition — or set your club — and it will show up here
        with its own switch.
      </p>
    );
  }

  function handleToggle(entity: NotifiableEntity) {
    const nextMuted = !entity.muted;
    setError(null);
    setPendingId(entity.id);
    setState((current) =>
      current.map((row) => (row.id === entity.id && row.type === entity.type ? { ...row, muted: nextMuted } : row)),
    );

    startTransition(async () => {
      const result = await setEntityMuted(entity.type, entity.id, nextMuted);
      if (result.error) {
        setState((current) =>
          current.map((row) =>
            row.id === entity.id && row.type === entity.type ? { ...row, muted: entity.muted } : row,
          ),
        );
        setError(result.error);
      }
      setPendingId(null);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {GROUP_ORDER.map((group) => {
        const rows = state.filter((entity) => entity.type === group);
        if (rows.length === 0) return null;
        const Icon = ICON[group];

        return (
          <div key={group} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground-subtle">
              <Icon className="h-3 w-3" strokeWidth={2} />
              {GROUP_LABEL[group]}
            </span>
            {rows.map((entity, index) => (
              <div
                key={`${entity.type}:${entity.id}`}
                className={`flex items-center justify-between gap-4 py-3 ${index > 0 ? "border-t border-hairline-soft" : ""}`}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm text-foreground">{entity.name}</span>
                  <span className="text-xs text-foreground-subtle">
                    {entity.muted ? "Muted — no alerts about this" : entity.reason}
                  </span>
                </div>
                <ToggleSwitch
                  checked={!entity.muted}
                  disabled={pendingId === entity.id}
                  onChange={() => handleToggle(entity)}
                  label={`Notifications about ${entity.name}`}
                />
              </div>
            ))}
          </div>
        );
      })}

      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}
    </div>
  );
}
