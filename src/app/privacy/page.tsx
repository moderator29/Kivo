import Link from "next/link";
import type { Metadata } from "next";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { LegalNotice } from "@/components/marketing/legal-notice";
import { FadeIn } from "@/components/ui/fade-in";

export const metadata: Metadata = {
  title: "Privacy Policy | KIVO",
  description: "How KIVO collects, uses and stores your data, and how the AI Copilot handles what you ask it.",
};

const LAST_UPDATED = "August 15, 2026";

export default function PrivacyPage() {
  return (
    <MarketingPageShell>
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-8 pt-8 sm:px-6 sm:pt-12 lg:px-12 lg:pt-16">
        <FadeIn>
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-kivo-cyan">Legal</span>
        </FadeIn>
        <FadeIn delay={0.06}>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Privacy Policy</h1>
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
              describes KIVO&apos;s actual, current data practices as accurately as we can state them from the real
              codebase, but it has not been reviewed by a lawyer. Get real legal review before relying on this for a
              public launch.
            </p>
          </LegalNotice>
        </FadeIn>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 lg:px-12 lg:pb-24">
        <FadeIn className="kivo-glass-brand flex flex-col gap-10 rounded-2xl p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">1. The short version</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              KIVO collects what it needs to run your account and the features you use: your email (via Clerk, our
              authentication provider), the profile details you choose to add, and the activity you generate inside
              the app (predictions, fantasy teams, posts, follows, XP). Football data (scores, fixtures, players) is
              sourced from a third-party sports data provider and is about matches, not about you. If you use the AI
              Copilot, your question and some of your KIVO data are sent to Anthropic to generate a reply. We do not
              sell your data, and as of this writing KIVO runs no third-party advertising or analytics tracking.
              The sections below go into more detail on each of these.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">2. Information collected at signup</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              KIVO uses Clerk to handle authentication, we never see or store your password ourselves. When you
              create an account with email, Clerk collects and verifies your email address. If you continue with X
              instead, Clerk receives the basic profile information X shares as part of that sign-in (your name,
              handle and avatar). During onboarding, you choose a KIVO username, which is required, and can
              optionally add a display name, a short bio, your country and a favourite team. All of this is stored
              in KIVO&apos;s own database, tied to your account.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">3. What KIVO&apos;s own database stores</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              Beyond your profile, KIVO stores the activity you generate while using the product, all tied to your
              account:
            </p>
            <ul className="flex flex-col gap-2 pl-1 text-sm leading-relaxed text-foreground-muted sm:text-base">
              <li>• Predictions you submit on fixtures, and your standing on the predictions leaderboard.</li>
              <li>• Fantasy teams and rosters you build, and the leagues you join.</li>
              <li>• Posts and comments you write in Match Rooms and elsewhere in the app.</li>
              <li>• Accounts you follow, and who follows you.</li>
              <li>• XP earned and badges awarded to your account.</li>
              <li>• Reports you file against content or other users, and reports filed against your own content.</li>
              <li>
                • If you use the AI Copilot: your questions and its answers, so your conversation history persists
                across sessions.
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">4. Football data is not about you</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              Scores, fixtures, standings, teams, players and similar football data come from API-Football, a
              third-party football data provider, and KIVO syncs and caches it into its own database to power the
              app. This data describes matches, teams and players. It is not collected about you, and using KIVO
              does not send your personal information to the football data provider.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">5. How the AI Copilot handles your data</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              When you ask the AI Copilot a question, KIVO sends your message, a short window of your recent
              conversation history, and a grounding context built from KIVO&apos;s own data (things like today&apos;s
              synced fixtures and relevant profile context, such as your favourite team) to Anthropic&apos;s API to
              generate the reply. The Copilot is instructed to say plainly when KIVO doesn&apos;t have data for
              something rather than invent an answer. Your questions and the Copilot&apos;s replies are stored in
              KIVO&apos;s database so your conversation persists, the same as any other feature on the platform.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">6. What KIVO does not do</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              As of this writing, KIVO does not run any third-party advertising, analytics, or tracking pixels of any
              kind, does not sell or rent your data to data brokers or advertisers, and does not send you marketing
              email. If any of that changes in the future, this policy will be updated first and, where required by
              law, you&apos;ll be asked for consent.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">7. Who KIVO shares data with</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              KIVO relies on a small set of infrastructure providers to run the product, each handling only the data
              needed for their part:
            </p>
            <ul className="flex flex-col gap-2 pl-1 text-sm leading-relaxed text-foreground-muted sm:text-base">
              <li>• <span className="text-foreground">Clerk</span>: authentication and identity (your email, sign-in method, account credentials).</li>
              <li>• <span className="text-foreground">Supabase</span>: hosts KIVO&apos;s application database (your profile, posts, predictions, fantasy data and everything else described above), access-controlled per account.</li>
              <li>• <span className="text-foreground">API-Football</span>: supplies football data (fixtures, teams, players, scores); does not receive data about you.</li>
              <li>• <span className="text-foreground">Anthropic</span>: receives your message and grounding context only when you use the AI Copilot, to generate a reply.</li>
            </ul>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              We do not sell your personal information to third parties.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">8. Your account, your control</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              You can view and edit your profile details from Settings at any time. Deleting your account (also
              from Settings, with a typed confirmation) permanently deletes your Clerk identity, which in turn
              removes your KIVO profile and the data tied to it: posts, comments, predictions, fantasy teams and XP.
              This action cannot be undone. If you&apos;d like a copy of your data before deleting your account, or
              have another access or export request, you can reach out through the contact channel below.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">9. Age requirement</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              KIVO is not directed at children and is not designed for use by anyone under 13 years old. You must be
              at least 13 to create a KIVO account. KIVO does not knowingly collect personal information from
              children under 13, and if we become aware that we have, we will delete it.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">10. Security</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              Authentication is handled entirely by Clerk, KIVO never stores your password. Application data in
              Supabase is access-controlled with row-level security tied to your authenticated identity, so your
              private data (like your own draft content or account settings) is only readable by you and, where a
              feature is explicitly public (like a public post), by other users through that feature.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">11. Changes to this policy</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              As KIVO adds features, this policy will be updated to reflect what actually changed, and the
              &ldquo;last updated&rdquo; date at the top will move. We won&apos;t backdate a change that expands what
              we collect or share without calling it out.
            </p>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/5 pt-8">
            <h2 className="text-lg font-semibold text-foreground sm:text-xl">12. Contact</h2>
            <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">
              This template does not yet list a monitored contact address. A real, monitored contact channel needs
              to be added here before this policy is used with the public, alongside the legal review noted at the
              top of this page.
            </p>
          </div>
        </FadeIn>
      </section>

      <section className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6 lg:px-12 lg:pb-24">
        <FadeIn className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-foreground-subtle">
            Also see our{" "}
            <Link href="/terms" className="text-kivo-cyan transition-colors hover:text-foreground">
              Terms of Service
            </Link>
            .
          </p>
        </FadeIn>
      </section>
    </MarketingPageShell>
  );
}
