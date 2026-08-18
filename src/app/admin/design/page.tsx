import type { Metadata } from "next";
import { Palette } from "lucide-react";
import {
  CONTAINER_ROLES,
  DENSITY_RULES,
  GRADIENTS,
  SURFACE_TIERS,
  TOKEN_GROUPS,
  TYPE_STEPS,
  ICON_STROKE,
} from "@/lib/design-system";
import { DesignTokenTable } from "@/components/admin/design-token-table";
import { DesignMotionDemo } from "@/components/admin/design-motion-demo";
import { DesignDensityDemo } from "@/components/admin/design-density-demo";
import { FadeIn } from "@/components/ui/fade-in";

export const metadata: Metadata = {
  title: "Design system",
  // Internal tool behind the admin role gate — never something to index.
  robots: { index: false, follow: false },
};

/**
 * KIVO's design system, rendered against the live stylesheet.
 *
 * KN-63. The rules live in src/lib/design-system.ts; this page paints them.
 * The point is not documentation for its own sake — it is that
 * RECOMMENDATIONS.md items 319 and 320 both ask for an *audit* ("is the right
 * glass tier on the right content", "does glow intensity track significance"),
 * and an audit against prose is a memory test. Against a page that shows every
 * tier next to its rule, in the theme you are currently looking at, it is a
 * comparison.
 *
 * It lives under /admin rather than in `docs/` for the same reason: a
 * stylesheet reference that is not rendered by the real app, in the real
 * themes, with the real fonts, goes stale silently.
 */
export default function AdminDesignPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 pb-16">
      <FadeIn className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-accent">
          <Palette className="h-4 w-4" strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wider">Internal reference</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Design system</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-foreground-muted">
          Every rule, token, surface tier and motion vocabulary KIVO actually ships. Values are read from
          the live stylesheet in the theme you are currently in — switch the theme from the top bar to
          audit the other palette against the same rules.
        </p>
        <p className="max-w-2xl text-[13px] leading-relaxed text-foreground-subtle">
          Read top to bottom before building a screen. The first three sections are the ones that decide
          whether a page feels considered or merely correct; the token tables below them are reference.
        </p>
      </FadeIn>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Density"
          blurb="The rules that decide whether a screen breathes. Each one is a relationship between two measurements rather than a value, which is why none of them can be a token and all of them have to be said out loud."
        />
        <DesignDensityDemo />
        <div className="kivo-glass flex flex-col overflow-hidden rounded-2xl">
          {DENSITY_RULES.map((rule, index) => (
            <div
              key={rule.title}
              className={`flex flex-col gap-1.5 p-5 ${index > 0 ? "border-t border-hairline-soft" : ""}`}
            >
              <h3 className="text-sm font-semibold text-foreground">{rule.title}</h3>
              <p className="text-[13px] leading-relaxed text-foreground-muted">{rule.rule}</p>
              <p className="text-[13px] leading-relaxed text-foreground-subtle">{rule.why}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Containers"
          blurb="A container is not a radius you pick and a padding you pick — it is one of these five things. Radius, padding and internal gap move together, and the values follow what the codebase already reached for most often at each size."
        />
        <div className="kivo-glass flex flex-col overflow-hidden rounded-2xl">
          {CONTAINER_ROLES.map((role, index) => (
            <div
              key={role.id}
              className={`flex flex-col gap-1.5 p-5 ${index > 0 ? "border-t border-hairline-soft" : ""}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-semibold text-foreground">{role.title}</h3>
                <code className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-accent">{role.spec}</code>
              </div>
              <p className="text-[13px] leading-relaxed text-foreground-muted">{role.rule}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Type"
          blurb="Six steps, and the list is closed. Anything below the label step — the app still contains 14 uses of 10px and 3 of 9px — is a defect to fix rather than a size to choose."
        />
        <div className="kivo-glass flex flex-col overflow-hidden rounded-2xl">
          {TYPE_STEPS.map((step, index) => (
            <div
              key={step.title}
              className={`flex flex-col gap-2 p-5 ${index > 0 ? "border-t border-hairline-soft" : ""}`}
            >
              <span className={step.className}>{step.title}</span>
              <code className="w-fit rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-foreground-subtle">
                {step.className}
              </code>
              <p className="text-[13px] leading-relaxed text-foreground-muted">{step.rule}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Surface tiers"
          blurb="Depth is state, not decoration. The tier says how important this content is right now — which is why the strongest tier is the one with a reservation attached."
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {SURFACE_TIERS.map((tier) => (
            <div key={tier.className} className="flex flex-col gap-3">
              <div className={`${tier.className} flex h-20 items-center justify-center rounded-2xl px-4`}>
                <code className="text-[11px] font-medium text-foreground">.{tier.className.split(" ").join(" .")}</code>
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold text-foreground">{tier.title}</h3>
                <p className="text-[13px] leading-relaxed text-foreground-muted">{tier.rule}</p>
                <p className="text-[11px] text-foreground-subtle">{tier.examples}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Motion"
          blurb="Two vocabularies and one reservation. Content arrives calmly, chrome responds like an object the user just touched, and exactly one signature is allowed to celebrate."
        />
        <DesignMotionDemo />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Brand gradients"
          blurb="Five ramps, each with a job. A gradient in KIVO is a claim about what kind of thing this is — AI, live, earned — so reaching for one because it looks good is how the claim stops meaning anything."
        />
        <div className="kivo-glass flex flex-col overflow-hidden rounded-2xl">
          {GRADIENTS.map((gradient, index) => (
            <div
              key={gradient.className}
              className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 ${
                index > 0 ? "border-t border-hairline-soft" : ""
              }`}
            >
              <div className={`${gradient.className} h-10 w-full shrink-0 rounded-lg sm:w-32`} aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{gradient.title}</h3>
                  <code className="text-[11px] text-foreground-subtle">.{gradient.className}</code>
                </div>
                <p className="text-[13px] leading-relaxed text-foreground-muted">{gradient.rule}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {TOKEN_GROUPS.map((group) => (
        <section key={group.id} className="flex flex-col gap-4">
          <SectionHeading title={group.title} blurb={group.intent} />
          <DesignTokenTable group={group} />
        </section>
      ))}

      {/* ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-4">
        <SectionHeading
          title="Icons"
          blurb="lucide-react at an optically-corrected stroke weight. Small icons need a heavier stroke to stay legible and large ones need a lighter one to stay elegant — a single weight everywhere is not consistency, it is a rendering artefact."
        />
        <div className="kivo-glass flex flex-col gap-3 rounded-2xl p-4">
          <p className="text-[13px] leading-relaxed text-foreground-muted">
            Use <code className="rounded bg-surface-2 px-1 py-0.5 text-[11px]">{"<Icon>"}</code> from{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[11px]">@/components/ui/icon</code>, which
            derives the weight from the size. The scale, and the lint rule that enforces it, live in{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[11px]">src/lib/design-system.ts</code> and{" "}
            <code className="rounded bg-surface-2 px-1 py-0.5 text-[11px]">eslint-rules/icon-stroke-weight.mjs</code>.
          </p>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-hairline-soft pb-3">
      <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      <p className="max-w-2xl text-[13px] leading-relaxed text-foreground-subtle">{blurb}</p>
    </div>
  );
}
