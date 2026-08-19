import type { ReactNode } from "react";
import { Lock, type LucideIcon } from "lucide-react";
import { FadeIn } from "@/components/ui/fade-in";

/**
 * The three pieces of chrome every /admin page wears.
 *
 * ADMIN IA PASS 2026-08-19. Before this, each admin page invented its own: the
 * Support page used a 2xl heading with an icon, Users and Moderation used an xl
 * heading with none, Data Health used an xl heading and put its lede in a
 * different colour again. Panels below them each rolled a fourth and fifth
 * heading style. Nine pages, six typographic systems, none of them wrong on its
 * own and all of them wrong together.
 *
 * Admin is an operator's tool, held to the same bar as the product: one page
 * header, one section header, one access notice. The vocabulary inside them is
 * deliberately technical — that is the whole point of the section — but the
 * shapes are shared, so a new panel has one obvious way to look.
 */

export function AdminPageHeader({
  icon: Icon,
  title,
  lede,
  /**
   * What loading or acting on this page costs, when it costs anything. Stated
   * on the page rather than only on the button, because a page that spends a
   * provider request just by being opened has to say so before it is opened —
   * the same rule `catalogue-action-buttons.tsx` applies to buttons.
   */
  cost,
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  lede?: ReactNode;
  cost?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <FadeIn className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
          {Icon && <Icon className="h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />}
          {title}
        </h1>
        {lede && <p className="text-sm leading-relaxed text-foreground-muted">{lede}</p>}
        {cost && <p className="text-xs leading-relaxed text-foreground-subtle">{cost}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </FadeIn>
  );
}

/**
 * A titled band of related panels.
 *
 * `note` is for the one sentence that stops the section being misread — what it
 * counts, what it does not, whether reading it spends anything. Sections that
 * need no such sentence should not have one.
 */
export function AdminSection({
  icon: Icon,
  title,
  note,
  aside,
  children,
  delay = 0,
}: {
  icon?: LucideIcon;
  title: string;
  note?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  delay?: number;
}) {
  return (
    <section className="flex flex-col gap-3">
      <FadeIn delay={delay} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-foreground-muted">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden="true" />}
            {title}
          </h2>
          {note && <p className="max-w-2xl text-xs leading-relaxed text-foreground-subtle">{note}</p>}
        </div>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </FadeIn>
      {children}
    </section>
  );
}

/**
 * "You can reach /admin, but not this."
 *
 * One component rather than four near-identical blocks, because the sentence
 * they all have to get right is the same one: this is not an empty queue, it is
 * a queue you cannot see. A role with real access elsewhere (football_data_admin
 * on the football pages, support_admin on Support) lands here often enough that
 * an ambiguous "nothing found" would be read as good news.
 */
export function AdminAccessNotice({
  title,
  role,
  /** What the data is, in the sentence "X isn't part of your role". */
  subject,
  /** Why it is restricted, when there is a reason worth naming. */
  because,
}: {
  title: string;
  role: string | null | undefined;
  subject: string;
  because?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={title} />
      <FadeIn className="kivo-glass flex flex-col items-center gap-3 rounded-2xl p-8 text-center sm:p-10">
        <Lock className="h-8 w-8 text-foreground-subtle" strokeWidth={1.5} aria-hidden="true" />
        <p className="max-w-md text-sm leading-relaxed text-foreground-muted">
          {subject} isn&apos;t part of your role (
          <span className="font-medium text-foreground">{role ?? "no role"}</span>). This isn&apos;t empty —
          it&apos;s outside what your access covers.
        </p>
        {because && <p className="max-w-md text-xs leading-relaxed text-foreground-subtle">{because}</p>}
      </FadeIn>
    </div>
  );
}
