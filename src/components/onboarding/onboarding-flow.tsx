"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { StaticImageData } from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight, Check, Sparkles, X } from "lucide-react";
import kivoIntroArtwork from "../../../public/brand/kivo-artwork-hero.webp";
import kivoUsernameArtwork from "../../../public/brand/kivo-artwork-social.webp";
import kivoTeamArtwork from "../../../public/brand/kivo-artwork-action.webp";
import { saveUsernameStep, finishOnboarding, skipOnboarding, checkUsername } from "@/app/onboarding/actions";
import type { OnboardingCompletion } from "@/app/onboarding/actions";
import type { AwardedBadge } from "@/lib/rewards";
import { TeamCrest } from "@/components/ui/team-crest";
import { KivoAvatar } from "@/components/ui/kivo-avatar";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";
import { CountUp } from "@/components/ui/count-up";
import { useDeviceTimeZone } from "@/lib/use-device-timezone";

const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
const AVAILABILITY_DEBOUNCE_MS = 450;

type Team = {
  id: string;
  name: string;
  short_name: string | null;
  crest_url: string | null;
};

// The four pageable slides of the carousel, in order. "success" isn't part
// of this list on purpose — it's a one-way completion screen reached only
// after a real server round trip, not something a dot represents or you can
// page back into (there's nothing to "go back" to once the badge/XP are
// actually on the ledger).
type Step = "intro" | "username" | "team";
type FlowStep = Step | "success";

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * Editorial, image-led onboarding carousel: one large hero visual, one bold
 * headline, one line of subtext and a single full-width pill CTA per step —
 * style-inspired by travel-app onboarding, adapted to KIVO's own real
 * content (a username and an optional favourite team, nothing invented).
 * Ends on a genuine completion screen showing the actual badge + XP just
 * earned (see finishOnboarding in src/app/onboarding/actions.ts), not a
 * silent redirect straight past it.
 */
export function OnboardingFlow({
  defaultUsername,
  availableTeams,
  avatarSrc,
}: {
  defaultUsername: string;
  availableTeams: Team[];
  avatarSrc: string | null;
}) {
  const router = useRouter();
  const hasTeams = availableTeams.length > 0;
  const steps: Step[] = hasTeams ? ["intro", "username", "team"] : ["intro", "username"];

  const [step, setStep] = useState<FlowStep>("intro");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [award, setAward] = useState<OnboardingCompletion | null>(null);

  // KN-89. The device's own zone, read from the platform rather than during
  // render: the server has no device zone to resolve, so reading it during
  // render would make the first paint disagree with hydration for every
  // visitor outside UTC. Shown to the user below before it is saved (see the
  // disclosure line under the carousel) — KIVO is told a timezone, it never
  // works one out from an IP address.
  const deviceTimezone = useDeviceTimeZone();

  const [usernameValue, setUsernameValue] = useState(
    defaultUsername.startsWith("user_") ? "" : defaultUsername,
  );
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const availabilityRequestId = useRef(0);
  const debounceTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced from the onChange handler itself, not a `usernameValue` effect
  // — an effect would need to call setAvailability("idle") synchronously for
  // an invalid candidate, which is exactly the "derive state via effect"
  // anti-pattern (see https://react.dev/learn/you-might-not-need-an-effect).
  // Driving it from the event handler keeps every setAvailability call
  // inside a callback (this handler, the debounce timer, or the check's
  // response), never synchronously inside an effect body.
  function handleUsernameChange(rawValue: string) {
    // Normalise as the user types rather than validating after the fact.
    // The server stores `username.trim().toLowerCase()` and the availability
    // check lowercases too — so typing "Puffnutz_" reported "Available"
    // (correctly, "puffnutz_" was free) while the input's own
    // `pattern="[a-z0-9_]+"` silently blocked submit with the browser's
    // useless "Match the requested format". Showing the user the exact
    // string that will be saved removes the contradiction entirely: there is
    // no invalid state to report, because uppercase is folded on the way in.
    const value = rawValue.toLowerCase();
    setUsernameValue(value);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

    const candidate = value.trim();
    if (!USERNAME_PATTERN.test(candidate)) {
      setAvailability("idle");
      return;
    }

    setAvailability("checking");
    const requestId = ++availabilityRequestId.current;
    debounceTimeout.current = setTimeout(() => {
      checkUsername(candidate).then((result) => {
        // A newer keystroke may have already kicked off another check —
        // ignore a stale response landing after it so the indicator never
        // flickers back to reflect an outdated candidate.
        if (availabilityRequestId.current !== requestId) return;
        setAvailability(result.available === null ? "idle" : result.available ? "available" : "taken");
      });
    }, AVAILABILITY_DEBOUNCE_MS);
  }

  // Only cleans up the pending timer on unmount — never calls setState, so
  // this doesn't trip the "no setState directly in an effect" rule above.
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    };
  }, []);

  function goTo(next: FlowStep, dir: 1 | -1) {
    setError(null);
    setDirection(dir);
    setStep(next);
  }

  function handleBack() {
    if (step === "username") goTo("intro", -1);
    else if (step === "team") goTo("username", -1);
  }

  function handleUsernameSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await saveUsernameStep(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (hasTeams) {
        goTo("team", 1);
      } else {
        await complete(null);
      }
    });
  }

  // A failed write must not advance to a congratulations screen: the profile
  // would still be `onboarding_completed: false`, so /home would bounce the
  // user straight back here. Surface the real error on the step they're on
  // and let them retry instead.
  async function complete(teamId: string | null) {
    const result = await finishOnboarding(teamId, deviceTimezone);
    if (result.error) {
      setError(result.error);
      return;
    }
    setAward(result);
    goTo("success", 1);
  }

  function handleTeamContinue(teamId: string | null) {
    startTransition(() => complete(teamId));
  }

  function handleSkipAll() {
    // Bypasses the flow entirely — unlike finishOnboarding, this awards
    // nothing (see skipOnboarding's own doc comment), so there's no
    // completion screen to show: it redirects straight to /home itself.
    startTransition(() => skipOnboarding());
  }

  const activeIndex = steps.indexOf(step as Step);

  return (
    <div className="relative z-10 flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-2 py-4">
      <div className="flex h-11 items-center justify-start">
        {step === "intro" ? (
          <KivoMarkGlyph size={30} />
        ) : step !== "success" ? (
          <button
            type="button"
            onClick={handleBack}
            aria-label="Back"
            className="kivo-glass kivo-glass-interactive flex h-10 w-10 items-center justify-center rounded-full transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-foreground" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>

      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.div
          key={step}
          custom={direction}
          initial={{ opacity: 0, x: direction * 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -24 }}
          transition={{ duration: 0.32, ease: EASE }}
        >
          {step === "intro" && <IntroPanel onNext={() => goTo("username", 1)} />}

          {step === "username" && (
            <UsernamePanel
              usernameValue={usernameValue}
              onUsernameChange={handleUsernameChange}
              availability={availability}
              error={error}
              pending={pending}
              onSubmit={handleUsernameSubmit}
              onSkip={handleSkipAll}
            />
          )}

          {step === "team" && (
            <TeamPanel
              teams={availableTeams}
              selectedTeamId={selectedTeamId}
              onSelect={setSelectedTeamId}
              pending={pending}
              onContinue={() => handleTeamContinue(selectedTeamId)}
              onSkip={() => handleTeamContinue(null)}
            />
          )}

          {step === "success" && award && (
            <SuccessPanel
              completion={award}
              fallbackAvatarSrc={avatarSrc}
              // `replace`, not `push`: onboarding is done, so this entry in
              // history now redirects to /home anyway — leaving it there just
              // makes Back feel broken.
              onContinue={() => router.replace("/home")}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* KN-89. Stated, not silent: the user sees which zone is about to be
          saved before the step that saves it, and is told where to change it.
          Absent entirely when the browser will not report one, rather than
          claiming a zone we do not have. */}
      {(step === "username" || step === "team") && deviceTimezone && (
        <p className="text-center text-[11px] text-foreground-subtle">
          Times will show in {deviceTimezone}. Change it any time in Settings.
        </p>
      )}

      {step !== "success" && <StepDots count={steps.length} activeIndex={activeIndex} />}
    </div>
  );
}

// Exported alongside the default flow purely so a throwaway dev harness can
// render each step in isolation (mock props, no real server actions) to
// visually verify layout at multiple viewports without a live Clerk
// session — see this feature's own report for how that was done. Doesn't
// change any behavior here.
export function StepDots({ count, activeIndex }: { count: number; activeIndex: number }) {
  if (count <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === activeIndex ? "w-6 bg-accent" : "w-1.5 bg-hairline-strong"
          }`}
        />
      ))}
    </div>
  );
}

// Edge-to-edge within the onboarding card (the `max-w-md` column in
// OnboardingFlow), not a small inset illustration — `-mx-2 self-stretch`
// cancels that column's own `px-2` and overrides its `items-center` on just
// this one flex child, so the image reaches the card's true left/right
// edges on every viewport instead of floating centered with visible gutters
// on both sides. `object-cover` (not `-contain`) fills that full-width band
// instead of letterboxing, matching the full-bleed, editorial-photography
// treatment the travel-app reference uses — `kivo-artwork-mask-bleed`
// (globals.css) softens only the top/bottom crop into the page rather than
// vignetting all four sides, which would undo the edge-to-edge width.
// RECOMMENDATIONS.md item 18 (this session's design/UX pass).
function HeroArt({ src }: { src: StaticImageData }) {
  return (
    <div className="relative -mx-2 flex h-[26vh] min-h-[180px] items-center justify-center self-stretch sm:h-[320px]">
      {/* The top/bottom fade is a DARK-mode treatment: the artwork is near-black
          at its edges, so dissolving it into an obsidian page is invisible and
          reads as full-bleed editorial photography. Over a near-white page the
          exact same mask fades dark art into light ground, which paints a grey
          smear along both edges instead of disappearing. So light mode drops
          the mask entirely and frames the art as what it honestly is there — a
          contained image card with a real edge and a soft shadow under it. */}
      <div className="kivo-artwork-float kivo-artwork-mask-bleed relative h-full w-full light:[mask-image:none]! light:[-webkit-mask-image:none]! light:overflow-hidden light:rounded-3xl light:ring-1 light:ring-hairline light:shadow-[0_18px_44px_-26px_rgba(11,14,23,0.5)]">
        <Image src={src} alt="" fill className="object-cover" sizes="(min-width: 640px) 448px, 100vw" />
      </div>
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">{children}</span>
  );
}

function PillButton({
  children,
  type = "button",
  onClick,
  disabled,
  pending,
}: {
  children: React.ReactNode;
  type?: "button" | "submit";
  onClick?: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-busy={pending}
      whileHover={disabled ? undefined : { scale: 1.02 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className="kivo-gradient-prime flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-base font-semibold text-kivo-white shadow-[0_8px_30px_-8px_rgba(37,99,255,0.55)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60"
    >
      {children}
    </motion.button>
  );
}

function SkipLink({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mx-auto text-xs font-medium text-foreground-subtle transition-colors hover:text-foreground-muted disabled:opacity-50"
    >
      Skip for now
    </button>
  );
}

export function IntroPanel({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-7 text-center">
      <HeroArt src={kivoIntroArtwork} />
      <div className="flex flex-col items-center gap-3">
        <Kicker>Welcome</Kicker>
        <h1 className="max-w-xs text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Football, one real home.
        </h1>
        <p className="max-w-xs text-sm text-foreground-muted">
          Scores, Match Rooms, fantasy and an AI Copilot — grounded in KIVO&apos;s own verified data. Two
          quick steps and you&apos;re in.
        </p>
      </div>
      <PillButton onClick={onNext}>
        Get started
        <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
      </PillButton>
    </div>
  );
}

export function UsernamePanel({
  usernameValue,
  onUsernameChange,
  availability,
  error,
  pending,
  onSubmit,
  onSkip,
}: {
  usernameValue: string;
  onUsernameChange: (value: string) => void;
  availability: "idle" | "checking" | "available" | "taken";
  error: string | null;
  pending: boolean;
  onSubmit: (formData: FormData) => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-7 text-center">
      <HeroArt src={kivoUsernameArtwork} />
      <div className="flex flex-col items-center gap-3">
        <Kicker>Your identity</Kicker>
        <h1 className="max-w-xs text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Claim your handle.
        </h1>
        <p className="max-w-xs text-sm text-foreground-muted">
          This is how other fans will see you in Match Rooms and the feed. Change it later anytime.
        </p>
      </div>

      <form action={onSubmit} className="flex w-full flex-col gap-3">
        <div className="relative">
          <input
            id="username"
            name="username"
            required
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]+"
            autoFocus
            value={usernameValue}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="e.g. lagos_ultra"
            className="w-full rounded-2xl border border-hairline bg-surface-1 px-4 py-4 pr-11 text-base text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2">
            {availability === "checking" && (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-foreground-subtle/30 border-t-foreground-subtle" />
            )}
            {availability === "available" && <Check className="h-4 w-4 text-live" strokeWidth={1.75} />}
            {availability === "taken" && <X className="h-4 w-4 text-critical" strokeWidth={1.75} />}
          </span>
        </div>

        <AnimatePresence>
          {error ? (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="text-xs text-critical"
            >
              {error}
            </motion.span>
          ) : availability === "available" ? (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="text-xs text-live"
            >
              Available
            </motion.span>
          ) : availability === "taken" ? (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="text-xs text-critical"
            >
              Taken. Try another.
            </motion.span>
          ) : null}
        </AnimatePresence>

        <PillButton type="submit" disabled={pending || availability === "taken"} pending={pending}>
          {pending ? "Saving…" : "Continue"}
          {!pending && <ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
        </PillButton>
      </form>

      <SkipLink onClick={onSkip} disabled={pending} />
    </div>
  );
}

export function TeamPanel({
  teams,
  selectedTeamId,
  onSelect,
  pending,
  onContinue,
  onSkip,
}: {
  teams: Team[];
  selectedTeamId: string | null;
  onSelect: (id: string) => void;
  pending: boolean;
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <HeroArt src={kivoTeamArtwork} />
      <div className="flex flex-col items-center gap-3">
        <Kicker>Your club</Kicker>
        <h1 className="max-w-xs text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Who do you support?
        </h1>
        <p className="max-w-xs text-sm text-foreground-muted">
          Optional — it&apos;s what makes Home and the AI Copilot feel like yours.
        </p>
      </div>

      <div className="grid max-h-56 w-full grid-cols-2 gap-2 overflow-y-auto pr-1">
        {teams.map((team) => {
          const isSelected = selectedTeamId === team.id;
          return (
            <button
              key={team.id}
              type="button"
              disabled={pending}
              onClick={() => onSelect(team.id)}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-xs font-medium transition-colors disabled:opacity-50 ${
                isSelected
                  ? "border-accent bg-accent-soft text-foreground"
                  : "border-hairline bg-surface-1 text-foreground-muted hover:border-hairline-strong hover:bg-surface-2"
              }`}
            >
              <TeamCrest crestUrl={team.crest_url} name={team.name} size={22} />
              <span className="truncate">{team.short_name ?? team.name}</span>
              {isSelected && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />}
            </button>
          );
        })}
      </div>

      <div className="flex w-full flex-col gap-3">
        <PillButton onClick={onContinue} disabled={pending || !selectedTeamId} pending={pending}>
          {pending ? "Saving…" : "Continue"}
          {!pending && <ArrowRight className="h-4 w-4" strokeWidth={1.75} />}
        </PillButton>
        <SkipLink onClick={onSkip} disabled={pending} />
      </div>
    </div>
  );
}

/**
 * The arrival moment. Everything on this screen is a fact the database now
 * holds about this specific user — the KIVO avatar assigned to their profile,
 * the handle they just claimed (as persisted, not as typed), the club they
 * picked, the badge row `awardBadge` returned, and XP that only appears if
 * the ledger insert really landed (see OnboardingCompletion in
 * src/app/onboarding/actions.ts). Anything that isn't real for this user is
 * omitted rather than substituted: no invented member number, no "you're the
 * Nth fan", no placeholder club.
 */
export function SuccessPanel({
  completion,
  fallbackAvatarSrc,
  onContinue,
}: {
  completion: OnboardingCompletion;
  fallbackAvatarSrc: string | null;
  onContinue: () => void;
}) {
  const { xpAwarded, badge, username, team } = completion;
  const avatarSrc = completion.avatarSrc ?? fallbackAvatarSrc;

  return (
    <div className="flex flex-col items-center gap-7 text-center">
      <BadgeReveal xp={xpAwarded} badge={badge} />

      <div className="flex flex-col items-center gap-3">
        <Kicker>You&apos;re in</Kicker>
        <h1 className="max-w-xs text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Welcome to KIVO.
        </h1>
        {/* Only claims the badge when there really is one — the `badges` row
            can legitimately be missing (an environment that never ran the
            0004 seed), and congratulating someone on a badge they don't hold
            is exactly the kind of invented detail this screen must not
            carry. */}
        <p className="max-w-xs text-sm text-foreground-muted">
          {badge
            ? "Your profile is live and your first badge is on it. Here's what's yours."
            : "Your profile is live. Here's what's yours."}
        </p>
      </div>

      <dl className="kivo-glass w-full divide-y divide-hairline-soft overflow-hidden rounded-3xl text-left">
        <SummaryRow label="Your handle">
          {/* The KIVO avatar this account was assigned, at the same modest
              scale every other avatar surface in the app uses (profile
              header 64px, settings preview 56px). Deliberately not blown up
              into a hero portrait: RECOMMENDATIONS.md item 233 records that
              the five confirmed-clean avatars still have a squad number
              printed on the jersey that happens to match their own asset
              index, which is illegible at avatar scale but becomes plainly
              readable at 100px+ — and an internal id must never be visible
              in the UI. */}
          <KivoAvatar src={avatarSrc} name={username} size={24} />
          <span className="truncate font-semibold text-foreground">@{username}</span>
        </SummaryRow>

        {team && (
          <SummaryRow label="Your club">
            <TeamCrest crestUrl={team.crest_url} name={team.name} size={20} />
            <span className="truncate font-semibold text-foreground">{team.name}</span>
          </SummaryRow>
        )}

        {badge && (
          <SummaryRow label="First badge">
            <BadgeIcon badge={badge} size={20} />
            <span className="truncate font-semibold text-foreground">{badge.name}</span>
          </SummaryRow>
        )}

        {xpAwarded > 0 && (
          <SummaryRow label="Experience">
            <Sparkles className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
            <span className="font-semibold text-foreground">+{xpAwarded} XP</span>
          </SummaryRow>
        )}
      </dl>

      <PillButton onClick={onContinue}>
        Enter KIVO
        <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
      </PillButton>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3.5">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-[0.14em] text-foreground-subtle">{label}</dt>
      <dd className="flex min-w-0 items-center gap-2 text-sm">{children}</dd>
    </div>
  );
}

// The badge's real icon when `badges.icon_url` has one, the KIVO mark when it
// doesn't — never a generic trophy stand-in that would imply a different
// award than the one actually earned.
function BadgeIcon({ badge, size }: { badge: AwardedBadge; size: number }) {
  if (!badge.icon_url) {
    return <KivoMarkGlyph size={size} />;
  }
  return (
    <Image
      src={badge.icon_url}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="shrink-0"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The hero of the completion screen: the real badge this user just earned,
 * lit and floating, with the real XP counting up beside it. The badge art is
 * a clean commissioned asset (`badges.icon_url`), which is why *this* is what
 * gets shown at hero scale rather than the user's avatar — see the note on
 * the handle row above. Falls back to the KIVO mark when the badge row has no
 * icon, never to a generic trophy that would imply a different award.
 */
function BadgeReveal({ xp, badge }: { xp: number; badge: AwardedBadge | null }) {
  return (
    <div className="relative flex h-[26vh] min-h-[180px] w-full items-center justify-center sm:h-[300px]">
      <div
        className="kivo-gradient-victory absolute h-56 w-56 rounded-full opacity-30 blur-3xl"
        aria-hidden="true"
      />
      <div className="kivo-artwork-float relative">
        <div className="kivo-glass-brand relative flex h-32 w-32 items-center justify-center rounded-full sm:h-40 sm:w-40">
          {badge?.icon_url ? (
            <Image
              src={badge.icon_url}
              alt=""
              width={72}
              height={72}
              className="h-16 w-16 drop-shadow-[0_0_16px_rgba(0,217,255,0.45)] sm:h-20 sm:w-20"
            />
          ) : (
            <KivoMarkGlyph size={64} />
          )}

          {xp > 0 && (
            <span className="absolute -bottom-2 right-0 whitespace-nowrap rounded-full border border-hairline bg-surface-3 px-3 py-1 text-xs font-bold text-live shadow-lg">
              {/* KN-75: was a second, near-identical copy of /rewards's own
                  hand-rolled count-up. Both are <CountUp> now. */}
              <CountUp value={xp} id="onboarding-xp" prefix="+" delaySeconds={0.3} /> XP
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
