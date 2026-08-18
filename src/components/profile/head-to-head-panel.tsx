import { Swords } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";
import { formatNumber } from "@/lib/format";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * "How do I compare with this person" (KN-105), from rows both already own.
 *
 * Three deliberate limits, each of which is what makes it publishable:
 *
 * 1. **It compares the viewer with one other person, never two strangers.** The
 *    viewer's side comes from `private.current_profile_id()` inside the RPC and
 *    is not passed in, so this cannot be used to build a comparison table of
 *    other people.
 * 2. **It respects `show_activity_publicly`.** A private account's numbers are
 *    withheld by the RPC — and the panel says so, rather than rendering zeros.
 *    A silent zero would be a lie about a private account, in the one place
 *    where the difference matters most.
 * 3. **It declares no winner.** Two people with different amounts of time on
 *    the platform are not in a contest, and calling one of them ahead would be
 *    a judgement the numbers do not support. It shows both columns and lets a
 *    person read them.
 */
type Row = {
  side: string;
  is_public: boolean;
  predictions_made: number;
  predictions_settled: number;
  predictions_correct: number;
  total_xp: number;
  badge_count: number;
  fantasy_points: number;
  shared_follows: number;
};

export async function HeadToHeadPanel({
  otherProfileId,
  otherName,
}: {
  otherProfileId: string;
  otherName: string;
}) {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.rpc("get_user_head_to_head", { p_other_profile_id: otherProfileId });

  // No rows means the viewer is not signed in, which the RPC enforces rather
  // than assuming. Nothing to compare against, so nothing is rendered — never
  // a comparison with a zeroed stand-in.
  if (error || !data || data.length < 2) return null;

  const rows = data as Row[];
  const you = rows.find((row) => row.side === "you");
  const them = rows.find((row) => row.side === "them");
  if (!you || !them) return null;

  const metrics: { label: string; you: string; them: string }[] = [
    {
      label: "Predictions made",
      you: formatNumber(you.predictions_made),
      them: formatNumber(them.predictions_made),
    },
    {
      label: "Correct calls",
      you: `${formatNumber(you.predictions_correct)} of ${formatNumber(you.predictions_settled)}`,
      them: `${formatNumber(them.predictions_correct)} of ${formatNumber(them.predictions_settled)}`,
    },
    { label: "XP", you: formatNumber(you.total_xp), them: formatNumber(them.total_xp) },
    { label: "Badges", you: formatNumber(you.badge_count), them: formatNumber(them.badge_count) },
    { label: "Fantasy points", you: formatNumber(you.fantasy_points), them: formatNumber(them.fantasy_points) },
  ];

  return (
    <FadeIn delay={0.06} className="kivo-glass flex flex-col gap-3 rounded-2xl p-5">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
        <Swords className="h-3.5 w-3.5" strokeWidth={2} />
        Compared with you
      </h2>

      {them.is_public ? (
        <table className="w-full text-left text-xs">
          <thead className="text-[11px] uppercase tracking-wide text-foreground-subtle">
            <tr>
              <th className="pb-2 font-medium">&nbsp;</th>
              <th className="pb-2 text-right font-medium">You</th>
              <th className="pb-2 text-right font-medium">{otherName}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline-soft">
            {metrics.map((metric) => (
              <tr key={metric.label} className="text-foreground-muted">
                <td className="py-2">{metric.label}</td>
                <td className="py-2 text-right text-foreground">{metric.you}</td>
                <td className="py-2 text-right text-foreground">{metric.them}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="rounded-xl bg-surface-1 p-3 text-xs text-foreground-muted">
          {otherName} keeps their activity private, so there is nothing to compare. Their numbers are withheld here
          rather than shown as zero.
        </p>
      )}

      {you.shared_follows > 0 && (
        <p className="text-[11px] text-foreground-subtle">
          You both follow {formatNumber(you.shared_follows)}{" "}
          {you.shared_follows === 1 ? "of the same club, player or competition" : "of the same clubs, players or competitions"}
          .
        </p>
      )}

      <p className="text-[11px] text-foreground-subtle">
        Both columns are real counts of each person&apos;s own activity. Nobody is &ldquo;ahead&rdquo; — two people
        who joined at different times aren&apos;t in a contest, and KIVO won&apos;t call one.
      </p>
    </FadeIn>
  );
}
