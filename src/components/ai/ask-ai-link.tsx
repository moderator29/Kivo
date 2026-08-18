import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * RECOMMENDATIONS.md items 184/185: the real entry point into fixture/team/
 * player-scoped AI grounding. A plain server-rendered `<Link>` (not a client
 * button) to `/ai?ctx=<type>&id=<id>` — `src/app/(app)/ai/page.tsx` resolves
 * that into a real `GroundingFocus` (see `src/lib/ai/grounding.ts`) before
 * the Copilot ever renders, the same "resolve on the server, degrade
 * honestly if the id doesn't resolve" pattern every other deep link in this
 * app follows.
 */
export function AskAiLink({ ctx, id, label }: { ctx: "fixture" | "team" | "player"; id: string; label?: string }) {
  return (
    <Link
      href={`/ai?ctx=${ctx}&id=${id}`}
      className="mt-4 flex items-center gap-1.5 text-xs font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <Sparkles className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      {label ?? "Ask AI about this"}
    </Link>
  );
}
