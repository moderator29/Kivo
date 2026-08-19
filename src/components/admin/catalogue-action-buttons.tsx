"use client";

import { useState, useTransition, type ReactNode } from "react";
import { AlertTriangle, Check, Download, Globe, ListPlus, RefreshCw, Users } from "lucide-react";
import {
  adoptCompetitions,
  fillCompetitionCountries,
  runSquadBackfill,
  syncCompetitionClubs,
} from "@/app/admin/data-health/catalogue-actions";

/**
 * The four buttons that build the club catalogue.
 *
 * ## Every one of them prints its price on its face
 *
 * The founder's account is on a free tier of roughly a hundred requests a day,
 * and the failure this whole feature exists to prevent is a button that quietly
 * eats the day. So the request cost is not in a tooltip or in the docs — it is
 * in the button's own label, before it is pressed, and it is the same number the
 * sync reserves against.
 *
 * Two of these cost nothing, and saying that just as loudly matters: they are
 * the ones that must run first, and an operator who assumes every button is
 * expensive will not press them.
 */

type Feedback = { tone: "ok" | "bad"; lines: string[] } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <div
      className={`flex items-start gap-1.5 text-xs ${feedback.tone === "bad" ? "text-critical" : "text-live"}`}
      role="status"
    >
      {feedback.tone === "bad" ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      ) : (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      )}
      <span className="flex flex-col gap-0.5">
        {feedback.lines.map((line, i) => (
          <span key={i}>{line}</span>
        ))}
      </span>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  busyLabel,
  cost,
  disabled,
  onRun,
}: {
  icon: ReactNode;
  label: string;
  busyLabel: string;
  /** The plain sentence stating what pressing this spends. Rendered under the
   * button, always, including when the answer is "nothing". */
  cost: string;
  disabled?: boolean;
  onRun: () => Promise<Feedback>;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={pending || disabled}
        aria-busy={pending}
        onClick={() => {
          if (pending || disabled) return;
          setFeedback(null);
          startTransition(async () => setFeedback(await onRun()));
        }}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-surface-1 px-4 py-2 text-sm font-semibold text-foreground-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      >
        {pending ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : icon}
        {pending ? busyLabel : label}
      </button>
      <p className="text-[11px] text-foreground-subtle">{cost}</p>
      <FeedbackLine feedback={feedback} />
    </div>
  );
}

export function AdoptCompetitionsButton() {
  return (
    <ActionButton
      icon={<ListPlus className="h-4 w-4" strokeWidth={1.75} />}
      label="Adopt allowlisted competitions"
      busyLabel="Adopting…"
      cost="Costs 0 provider requests. Reads the coverage registry you already paid one request for."
      onRun={async () => {
        const result = await adoptCompetitions();
        if (result.error) return { tone: "bad", lines: [result.error] };
        const adopted = result.competitions.filter((c) => c.status === "adopted").length;
        const known = result.competitions.filter((c) => c.status === "already-known").length;
        const missing = result.competitions.filter((c) => c.status === "not-in-registry");
        const lines = [`${adopted} created, ${known} already on file.`];
        if (missing.length > 0) {
          lines.push(
            `${missing.length} not in the registry (${missing.map((m) => m.providerId).join(", ")}) — refresh the coverage registry first, or these ids are not on this plan.`,
          );
        }
        return { tone: missing.length > 0 ? "bad" : "ok", lines };
      }}
    />
  );
}

export function FillCountriesButton() {
  return (
    <ActionButton
      icon={<Globe className="h-4 w-4" strokeWidth={1.75} />}
      label="Fill missing competition countries"
      busyLabel="Filling…"
      cost="Costs 0 provider requests. Only ever writes a country onto a competition that has none."
      onRun={async () => {
        const result = await fillCompetitionCountries();
        if (result.error) return { tone: "bad", lines: [result.error] };
        return {
          tone: "ok",
          lines: [`${result.recordsProcessed ?? 0} competition(s) gained a country from the registry.`],
        };
      }}
    />
  );
}

export function SyncClubsButton({
  competitionId,
  competitionName,
  disabled,
}: {
  competitionId: string;
  competitionName: string;
  disabled?: boolean;
}) {
  return (
    <ActionButton
      icon={<Download className="h-4 w-4" strokeWidth={1.75} />}
      label={`Sync ${competitionName} clubs`}
      busyLabel="Syncing clubs…"
      cost="Costs exactly 1 provider request, whatever the size of the league."
      disabled={disabled}
      onRun={async () => {
        const result = await syncCompetitionClubs(competitionId);
        if (result.error) {
          return { tone: "bad", lines: [result.error, `Requests spent: ${result.requestsSpent ?? 0}.`] };
        }
        return {
          tone: "ok",
          lines: [`${result.recordsProcessed ?? 0} club(s) written. Requests spent: ${result.requestsSpent ?? 0}.`],
        };
      }}
    />
  );
}

export function SquadBackfillButton({ maxClubs, disabled }: { maxClubs: number; disabled?: boolean }) {
  return (
    <ActionButton
      icon={<Users className="h-4 w-4" strokeWidth={1.75} />}
      label={`Back-fill up to ${maxClubs} squads`}
      busyLabel="Backfilling squads…"
      cost={`Costs up to ${maxClubs * 2} provider requests — 2 per club (squad and manager are separate endpoints). Reserved before the first call; if the allowance permits fewer clubs, fewer are done.`}
      disabled={disabled}
      onRun={async () => {
        const result = await runSquadBackfill(maxClubs);
        if (result.error) return { tone: "bad", lines: [result.error] };
        const lines = [
          `${result.clubsSynced} club(s) filled, ${result.playersProcessed} player/manager record(s) written. Requests spent: ${result.requestsSpent}.`,
        ];
        if (result.moreRemaining) {
          lines.push("More clubs are still queued — press again once the allowance allows, or tomorrow.");
        }
        for (const failure of result.failures.slice(0, 5)) {
          lines.push(`${failure.teamName}: ${failure.message}`);
        }
        return { tone: result.failures.length > 0 ? "bad" : "ok", lines };
      }}
    />
  );
}
