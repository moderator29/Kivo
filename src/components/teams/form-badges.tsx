import type { FormResult } from "@/lib/football/results";

/**
 * Shared W/D/L badge strip. Originally defined only inside `/teams/compare`
 * (as a local `FormBadges`); RECOMMENDATIONS.md item 160 adds a second call
 * site directly on `/teams/[id]`, so this moved out to a shared component
 * rather than a second copy of the same five little circles.
 */
export function FormBadges({ form }: { form: FormResult[] }) {
  if (form.length === 0) {
    return <p className="text-sm text-foreground-muted">No results synced yet.</p>;
  }
  const style: Record<FormResult, string> = {
    W: "border-live/30 bg-live/10 text-live",
    D: "border-hairline text-foreground-muted",
    L: "border-critical/30 bg-critical/10 text-critical",
  };
  return (
    <div className="flex items-center gap-1.5">
      {form.map((result, index) => (
        <span
          key={index}
          className={`flex h-7 w-7 items-center justify-center rounded-full border text-[11px] font-semibold ${style[result]}`}
        >
          {result}
        </span>
      ))}
    </div>
  );
}
