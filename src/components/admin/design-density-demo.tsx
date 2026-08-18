import { Trophy } from "lucide-react";

/**
 * The same content, laid out twice.
 *
 * Every rule in `DENSITY_RULES` is a claim about a *relationship* between two
 * measurements, which means none of them can be checked by looking at a token
 * table — you have to see two versions side by side. This renders exactly the
 * same four facts under the broken conventions the codebase drifted into, and
 * under the ladder, so "jam packed" stops being a matter of opinion.
 *
 * Server-rendered: it is static markup demonstrating CSS, and there is nothing
 * for a client bundle to do.
 */
export function DesignDensityDemo() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Column
        title="Drifted"
        note="Equal padding and gap, a box around every row, two radii fighting, and 10px meta text. Nothing here is individually wrong, which is exactly why it survives review."
        tone="bad"
      >
        <div className="kivo-glass flex flex-col gap-2 rounded-2xl p-2">
          <div className="flex items-center gap-1.5">
            <Trophy className="h-3.5 w-3.5 text-accent" strokeWidth={2} aria-hidden="true" />
            <span className="text-xs font-semibold text-foreground">Gameweek 12</span>
          </div>
          {[
            ["Points", "48"],
            ["Rank", "3rd"],
            ["Transfers left", "1"],
          ].map(([label, value]) => (
            <div key={label} className="kivo-glass flex items-center justify-between gap-1 rounded-2xl p-2">
              <span className="text-[10px] text-foreground-subtle">{label}</span>
              <span className="text-xs font-semibold text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </Column>

      <Column
        title="On the ladder"
        note="Panel padding beats the gap inside it, rows are hairlines instead of boxes, the inner radius steps down from the outer one, and the label step is uppercase 11px rather than sentence-case 10px."
        tone="good"
      >
        <div className="kivo-glass flex flex-col gap-4 rounded-2xl p-6">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-accent" strokeWidth={1.75} aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              Gameweek 12
            </span>
          </div>
          <div className="flex flex-col rounded-xl border border-hairline">
            {[
              ["Points", "48"],
              ["Rank", "3rd"],
              ["Transfers left", "1"],
            ].map(([label, value], index) => (
              <div
                key={label}
                className={`flex items-center justify-between gap-3 px-4 py-3 ${
                  index > 0 ? "border-t border-hairline-soft" : ""
                }`}
              >
                <span className="text-sm text-foreground-muted">{label}</span>
                <span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </Column>
    </div>
  );
}

function Column({
  title,
  note,
  tone,
  children,
}: {
  title: string;
  note: string;
  tone: "bad" | "good";
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${tone === "good" ? "bg-live" : "bg-critical"}`}
        />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {children}
      <p className="text-[13px] leading-relaxed text-foreground-subtle">{note}</p>
    </div>
  );
}
