"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { Trophy, KeyRound, Plus, Lock, Globe, Compass } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { createFantasyLeague, joinFantasyLeague } from "./actions";

type SeasonOption = { id: string; label: string };

const MAX_TEAMS_DEFAULT = 12;

export function FantasyOnboarding({ availableSeasons }: { availableSeasons: SeasonOption[] }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 lg:px-8">
      <FadeIn className="kivo-glass-brand flex flex-col items-center gap-3 rounded-2xl p-8 text-center">
        <div className="kivo-gradient-victory flex h-14 w-14 items-center justify-center rounded-2xl">
          <Trophy className="h-7 w-7 text-kivo-white" strokeWidth={1.75} />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Build your fantasy squad</h1>
        <p className="max-w-sm text-sm leading-relaxed text-foreground-muted">
          You haven&apos;t joined a fantasy league yet. Create one to start your own, or enter a friend&apos;s
          invite code to join theirs.
        </p>
      </FadeIn>

      <FadeIn delay={0.05}>
        <CreateLeagueCard availableSeasons={availableSeasons} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <JoinLeagueCard />
      </FadeIn>

      <FadeIn delay={0.15}>
        <Link
          href="/fantasy/browse"
          className="kivo-glass flex items-center justify-center gap-2 rounded-2xl p-4 text-sm font-semibold text-foreground-muted transition hover:bg-white/5 hover:text-foreground"
        >
          <Compass className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
          Browse public leagues
        </Link>
      </FadeIn>
    </div>
  );
}

function CreateLeagueCard({ availableSeasons }: { availableSeasons: SeasonOption[] }) {
  const nameId = useId();
  const seasonId = useId();
  const sizeId = useId();
  const [name, setName] = useState("");
  const [season, setSeason] = useState(availableSeasons[0]?.id ?? "");
  const [isPrivate, setIsPrivate] = useState(true);
  const [maxTeams, setMaxTeams] = useState(MAX_TEAMS_DEFAULT);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const disabled = availableSeasons.length === 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || pending) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your league a name.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createFantasyLeague({ name: trimmed, seasonId: season, isPrivate, maxTeams });
      if (result.error) setError(result.error);
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="kivo-glass flex flex-col gap-4 rounded-2xl p-5"
    >
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold text-foreground">Create a league</h2>
      </div>

      {disabled ? (
        <p className="rounded-xl bg-white/5 px-3 py-3 text-xs leading-relaxed text-foreground-subtle">
          No active season yet. Fantasy leagues need a season to attach to. Check back once this season&apos;s
          competition calendar is synced.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={nameId} className="text-xs font-medium text-foreground-muted">
              League name
            </label>
            <input
              id={nameId}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="e.g. Office League"
              disabled={pending}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-foreground-subtle focus:border-kivo-cyan/50 disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={seasonId} className="text-xs font-medium text-foreground-muted">
                Season
              </label>
              <select
                id={seasonId}
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                disabled={pending}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-kivo-cyan/50 disabled:opacity-60"
              >
                {availableSeasons.map((s) => (
                  <option key={s.id} value={s.id} className="bg-kivo-navy">
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={sizeId} className="text-xs font-medium text-foreground-muted">
                Max teams
              </label>
              <input
                id={sizeId}
                type="number"
                min={2}
                max={50}
                value={maxTeams}
                onChange={(e) => setMaxTeams(Number(e.target.value))}
                disabled={pending}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-kivo-cyan/50 disabled:opacity-60"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsPrivate(true)}
              disabled={pending}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition disabled:opacity-60 ${
                isPrivate ? "border-transparent bg-kivo-cyan/15 text-kivo-cyan" : "border-white/10 text-foreground-muted hover:bg-white/5"
              }`}
            >
              <Lock className="h-3.5 w-3.5" strokeWidth={1.75} />
              Private
            </button>
            <button
              type="button"
              onClick={() => setIsPrivate(false)}
              disabled={pending}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition disabled:opacity-60 ${
                !isPrivate ? "border-transparent bg-kivo-cyan/15 text-kivo-cyan" : "border-white/10 text-foreground-muted hover:bg-white/5"
              }`}
            >
              <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
              Public
            </button>
          </div>

          {error && <p className="text-xs text-critical">{error}</p>}

          <button
            type="submit"
            disabled={pending || !name.trim()}
            className="kivo-gradient-victory rounded-xl py-2.5 text-sm font-semibold text-kivo-white transition disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create league"}
          </button>
        </>
      )}
    </form>
  );
}

function JoinLeagueCard() {
  const codeId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!code.trim()) {
      setError("Enter an invite code.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await joinFantasyLeague(code);
      if (result.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="kivo-glass flex flex-col gap-4 rounded-2xl p-5">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-kivo-cyan" strokeWidth={1.75} />
        <h2 className="text-sm font-semibold text-foreground">Join with an invite code</h2>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={codeId} className="text-xs font-medium text-foreground-muted">
          Invite code
        </label>
        <input
          id={codeId}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={12}
          placeholder="e.g. K7X9QP"
          disabled={pending}
          className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center text-sm font-semibold tracking-[0.3em] text-foreground outline-none transition placeholder:tracking-normal placeholder:text-foreground-subtle focus:border-kivo-cyan/50 disabled:opacity-60"
        />
      </div>

      {error && <p className="text-xs text-critical">{error}</p>}

      <button
        type="submit"
        disabled={pending || !code.trim()}
        className="rounded-xl border border-white/10 py-2.5 text-sm font-semibold text-foreground transition hover:bg-white/5 disabled:opacity-50"
      >
        {pending ? "Joining…" : "Join league"}
      </button>
    </form>
  );
}
