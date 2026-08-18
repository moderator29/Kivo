"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Plus, LogOut, Copy, Check } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { formatNumber } from "@/lib/format";
import {
  createPredictionLeague,
  joinPredictionLeague,
  leavePredictionLeague,
} from "@/app/(app)/predictions/league-actions";
import type { PredictionLeagueSummary, PredictionLeagueStanding } from "@/lib/prediction-leagues";

/**
 * Prediction leagues (KN-104): create one, share a code, see where you sit.
 *
 * Two honesty rules the standings obey, both about the same thing — a
 * mid-season table is a partial one, and saying so is cheap:
 *
 *   - Every row shows how many of that member's calls have actually been
 *     scored, not just their total. A member with 12 points from 4 scored
 *     calls and one with 12 from 9 are in genuinely different positions.
 *   - A league where nothing has been scored yet says so instead of showing
 *     everybody on zero, which reads as "everyone got it wrong".
 */
export function PredictionLeaguesPanel({
  leagues,
  standingsByLeague,
}: {
  leagues: PredictionLeagueSummary[];
  standingsByLeague: Record<string, PredictionLeagueStanding[]>;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"none" | "create" | "join">("none");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createPredictionLeague({ name, maxMembers: 50 });
      if (result.error) {
        setError(result.error);
        return;
      }
      setName("");
      setMode("none");
      router.refresh();
    });
  }

  function submitJoin() {
    setError(null);
    startTransition(async () => {
      const result = await joinPredictionLeague(code);
      if (result.error) {
        setError(result.error);
        return;
      }
      setCode("");
      setMode("none");
      router.refresh();
    });
  }

  function leave(leagueId: string) {
    setError(null);
    startTransition(async () => {
      const result = await leavePredictionLeague(leagueId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <FadeIn className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Users className="h-3.5 w-3.5" strokeWidth={2} />
          Your prediction leagues
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode(mode === "create" ? "none" : "create")}
            className="kivo-glass-sharp flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            New
          </button>
          <button
            type="button"
            onClick={() => setMode(mode === "join" ? "none" : "join")}
            className="kivo-glass-sharp rounded-lg px-2.5 py-1 text-[11px] font-semibold text-foreground transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Join
          </button>
        </div>
      </div>

      {mode === "create" && (
        <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-4">
          <label className="text-xs text-foreground-subtle" htmlFor="prediction-league-name">
            League name
          </label>
          <div className="flex items-center gap-2">
            <input
              id="prediction-league-name"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sunday league"
              className="kivo-focusable min-w-0 flex-1 rounded-lg border border-hairline bg-surface-inset px-2.5 py-1.5 text-xs text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={pending || name.trim().length < 2}
              onClick={submitCreate}
              className="kivo-gradient-prime shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {mode === "join" && (
        <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-4">
          <label className="text-xs text-foreground-subtle" htmlFor="prediction-league-code">
            Invite code
          </label>
          <div className="flex items-center gap-2">
            <input
              id="prediction-league-code"
              value={code}
              maxLength={12}
              autoCapitalize="characters"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="ABC123"
              className="kivo-focusable min-w-0 flex-1 rounded-lg border border-hairline bg-surface-inset px-2.5 py-1.5 font-mono text-xs uppercase tracking-widest text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={pending || code.trim().length === 0}
              onClick={submitJoin}
              className="kivo-gradient-prime shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
            >
              Join
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}

      {leagues.length === 0 ? (
        <p className="kivo-glass rounded-2xl p-5 text-center text-xs text-foreground-muted">
          You&apos;re not in a prediction league yet. Create one and share the code, or join with a friend&apos;s.
        </p>
      ) : (
        leagues.map((league) => {
          const standings = standingsByLeague[league.id] ?? [];
          const anyScored = standings.some((row) => row.settled > 0);
          return (
            <div key={league.id} className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">{league.name}</span>
                  <span className="text-[11px] text-foreground-subtle">
                    {formatNumber(league.memberCount)} {league.memberCount === 1 ? "member" : "members"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {league.inviteCode && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(league.inviteCode!).then(() => {
                          setCopiedCode(league.inviteCode);
                          setTimeout(() => setCopiedCode(null), 2000);
                        });
                      }}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[11px] tracking-widest text-foreground-muted transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      {copiedCode === league.inviteCode ? (
                        <Check className="h-3 w-3" strokeWidth={2} />
                      ) : (
                        <Copy className="h-3 w-3" strokeWidth={2} />
                      )}
                      {league.inviteCode}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => leave(league.id)}
                    aria-label={`Leave ${league.name}`}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:text-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <LogOut className="h-3 w-3" strokeWidth={2} />
                  </button>
                </div>
              </div>

              {standings.length > 0 && (
                <ol className="flex flex-col divide-y divide-hairline-soft">
                  {standings.map((row, index) => (
                    <li key={row.profileId} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="flex min-w-0 items-center gap-2 text-xs">
                        <span className="w-4 shrink-0 text-foreground-subtle">{index + 1}</span>
                        <span className={`truncate ${row.isYou ? "font-semibold text-foreground" : "text-foreground-muted"}`}>
                          {row.displayName ?? `@${row.username}`}
                          {row.isYou && <span className="text-foreground-subtle"> · you</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-foreground">
                        {formatNumber(row.totalPoints)}
                        {/* A total on its own hides how much of it is settled.
                            12 points from 4 scored calls and 12 from 9 are
                            genuinely different positions in the same table. */}
                        <span className="text-[11px] text-foreground-subtle">
                          {" "}
                          · {formatNumber(row.correct)}/{formatNumber(row.settled)} scored
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}

              {!anyScored && standings.length > 0 && (
                <p className="text-[11px] text-foreground-subtle">
                  Nobody&apos;s calls have been scored yet, so everyone is level. This isn&apos;t a table of results
                  yet — it fills in as matches finish.
                </p>
              )}
            </div>
          );
        })
      )}
    </FadeIn>
  );
}
