import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { LegalNotice } from "@/components/marketing/legal-notice";
import { FadeIn } from "@/components/ui/fade-in";

export const metadata: Metadata = {
  title: "Terms of Service | KIVO",
  description: "The terms that govern using KIVO: your account, acceptable use, content ownership and more.",
};

const LAST_UPDATED = "August 15, 2026";

export default function TermsPage() {
  return (
    <MarketingPageShell>
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-8 pt-8 sm:px-6 sm:pt-12 lg:px-12 lg:pt-16">
        <FadeIn>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Legal</span>
        </FadeIn>
        <FadeIn delay={0.06}>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Terms of Service</h1>
        </FadeIn>
        <FadeIn delay={0.1}>
          <p className="text-sm text-foreground-subtle">Last updated: {LAST_UPDATED}</p>
        </FadeIn>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6 lg:px-12">
        <FadeIn>
          <LegalNotice>
            <p>
              <strong className="text-foreground">This is a working template, not legal advice.</strong> It
              describes how KIVO actually works today, but it has not been reviewed by a lawyer. Get real legal
              review before relying on this for a public launch.
            </p>
          </LegalNotice>
        </FadeIn>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 lg:px-12 lg:pb-24">
        <FadeIn className="kivo-glass-brand flex flex-col gap-10 rounded-3xl p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">1. Agreement to these terms</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              By creating a KIVO account or using KIVO, you agree to these terms. If you don&apos;t agree, don&apos;t
              use KIVO. You can browse scores, standings and other public parts of KIVO without an account, an
              account is only required to post, predict, build a fantasy team, or use other interactive features.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">2. Account eligibility</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              You must be at least 13 years old to create a KIVO account. You sign in with your email address:
              Supabase Auth, our authentication provider, emails you a one-time code and entering it signs you in.
              There is no password. You&apos;re responsible for keeping access to that email account secure and for
              the activity that happens under your KIVO account. One account per person, please.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">3. Acceptable use</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              KIVO is a space for football fans to talk about the game, including the arguments. It is not a space
              for harassment, hate speech, threats, spam, impersonation, or content that breaks the law. Match Rooms,
              posts and comments are moderated: any user can report content or another account, reports are reviewed
              by KIVO moderators, and content or accounts that violate these terms can be removed, restricted or
              suspended. Filing knowingly false reports to harass another user is itself a violation of these terms.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">4. Content you post</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              You own what you post to KIVO, posts, comments and anything else you create. By posting it, you grant
              KIVO a license to host, display, and distribute that content within the product, so other users can
              see it as intended (for example, in a Match Room or on your profile). You&apos;re responsible for
              making sure you have the right to post what you post, and for its content. KIVO can remove content
              that violates these terms or applicable law.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">5. Fantasy and predictions are entertainment only</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              KIVO&apos;s fantasy football and predictions features are free-to-play and for entertainment only.
              There is no real-money entry, wagering, or gambling of any kind on the platform. Leaderboard standing,
              XP and badges are in-app recognition, they carry no cash value and cannot be redeemed for money or
              prizes.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">6. Football data and the AI Copilot</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              Live scores, fixtures and other football data are sourced from a third-party provider and synced into
              KIVO. We work to keep this accurate but can&apos;t guarantee it&apos;s always current or error-free,
              and KIVO isn&apos;t liable for decisions you make based on it (including fantasy or prediction picks).
              The AI Copilot is built to answer from KIVO&apos;s own verified data and to say plainly when it
              doesn&apos;t know something, rather than guess, but it can still be wrong. Its answers are
              informational, not professional, financial or betting advice of any kind.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">7. Termination</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              You can delete your account at any time from Settings, this permanently removes your profile and the
              data tied to it and cannot be undone. KIVO can suspend or terminate an account that violates these
              terms, including for harassment, spam, or abuse of the platform&apos;s features.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">8. Disclaimers and limitation of liability</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              KIVO is provided &ldquo;as is,&rdquo; without warranties of any kind, including that it will always be
              available, error-free, or uninterrupted. This is placeholder boilerplate pending real legal review
              (see the notice above), not a finished liability provision.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">9. Changes to these terms</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              As KIVO changes, these terms will be updated to match, and the &ldquo;last updated&rdquo; date at the
              top will move. Continuing to use KIVO after an update means you accept the revised terms.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-hairline-soft pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">10. Contact</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              This template does not yet list a monitored contact address. A real, monitored contact channel needs
              to be added here before these terms are used with the public, alongside the legal review noted at the
              top of this page.
            </p>
          </div>
        </FadeIn>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 lg:px-12 lg:pb-24">
        <FadeIn className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-foreground-subtle">
            Also see our{" "}
            <Link href="/privacy" className="text-accent transition-colors hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </FadeIn>
      </section>
    </MarketingPageShell>
  );
}
