"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Star } from "lucide-react";
import { submitFanRating } from "@/app/(app)/matches/fan-rating-actions";
import { cn } from "@/lib/utils";

// RECOMMENDATIONS.md item 170: "suppress the aggregate display below a real
// minimum sample size (e.g. 3 ratings) rather than showing '100%' off one
// vote" — same MIN_MEANINGFUL_SAMPLE convention as HeadToHeadCard (item 161)
// and PredictionCard's consensus bar (item 168).
const MIN_MEANINGFUL_SAMPLE = 3;

type FanRatingCardProps = {
  fixtureId: string;
  signedIn: boolean;
  /** The caller's own real rating (fan_ratings_select_own), or null if they
   * haven't rated this fixture. */
  initialRating: number | null;
  /** Real values from get_fan_rating_summary — ratingCount is always safe to
   * show honestly; avgRating is only ever presented once ratingCount clears
   * MIN_MEANINGFUL_SAMPLE. */
  ratingCount: number;
  avgRating: number | null;
};

/**
 * Explicitly labelled as fan opinion, not a data-provider rating (item 170's
 * own framing) — this fills the gap where Sofascore-style ratings aren't
 * available on the free tier, without ever presenting a KIVO-only average as
 * if it came from a real stats provider.
 */
export function FanRatingCard({ fixtureId, signedIn, initialRating, ratingCount, avgRating }: FanRatingCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [rating, setRating] = useState(initialRating);
  const [hovered, setHovered] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic local aggregate — recomputed from the real previous values on
  // each pick, rolled back alongside `rating` if the server call fails.
  const [count, setCount] = useState(ratingCount);
  const [avg, setAvg] = useState(avgRating);

  function handlePick(value: number) {
    if (!signedIn) {
      router.push(`/sign-up?redirect_url=${encodeURIComponent(pathname)}`);
      return;
    }
    if (pending || value === rating) return;
    setError(null);

    const previousRating = rating;
    const previousCount = count;
    const previousAvg = avg;

    const isFirstRating = previousRating === null;
    const nextCount = isFirstRating ? previousCount + 1 : previousCount;
    const previousSum = (previousAvg ?? 0) * previousCount;
    const nextSum = isFirstRating ? previousSum + value : previousSum - previousRating! + value;

    setRating(value);
    setCount(nextCount);
    setAvg(nextCount > 0 ? nextSum / nextCount : null);

    startTransition(async () => {
      const result = await submitFanRating(fixtureId, value);
      if (result.error) {
        setRating(previousRating);
        setCount(previousCount);
        setAvg(previousAvg);
        setError(result.error);
      }
    });
  }

  const activeValue = hovered ?? rating ?? 0;

  return (
    <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Rate this match</h2>
        <span className="text-[11px] text-foreground-subtle">Fan opinion, not a provider rating</span>
      </div>

      <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            disabled={pending}
            onClick={() => handlePick(value)}
            onMouseEnter={() => setHovered(value)}
            onMouseLeave={() => setHovered(null)}
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value} star${value === 1 ? "" : "s"}`}
            className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 disabled:cursor-not-allowed"
          >
            <Star
              className={cn("h-6 w-6 transition-colors", activeValue >= value ? "fill-achievement text-achievement" : "text-foreground-subtle")}
              strokeWidth={1.5}
            />
          </button>
        ))}
      </div>

      {error && (
        <p className="text-xs text-critical" role="status" aria-live="polite">
          {error}
        </p>
      )}

      <p className="text-xs text-foreground-subtle">
        {count < MIN_MEANINGFUL_SAMPLE
          ? `${count} fan rating${count === 1 ? "" : "s"} so far. Too few for an average yet.`
          : `${avg!.toFixed(1)} average from ${count} fan ratings.`}
      </p>
    </div>
  );
}
