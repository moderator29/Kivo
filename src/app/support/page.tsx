import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPageShell } from "@/components/marketing/marketing-page-shell";
import { FadeIn } from "@/components/ui/fade-in";
import { SupportForm } from "./support-form";
import { SUPPORT_TOPICS, type SupportTopic } from "./topics";

export const metadata: Metadata = {
  title: "Get help | KIVO",
  description: "Stuck signing in to KIVO, or something not working? Tell us here and a person will read it.",
};

// Reads a search param (which topic to preselect) and must never be cached
// as one user's version.
export const dynamic = "force-dynamic";

/**
 * KN-118. KIVO signs people in with a six-digit code emailed to one address:
 * no password, no social login, no recovery factor. That is a clean flow right
 * up to the moment the email doesn't arrive — a silent bounce, a corporate spam
 * filter, one wrong character typed at sign-up — and at that point the product
 * had, quite literally, no route to a human anywhere in it. That user was gone.
 *
 * This page is that route, and it lives OUTSIDE the (app) group on purpose: the
 * person who needs it is by definition the person who cannot get past the gate.
 */
export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string | string[] }>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.topic) ? params.topic[0] : params.topic;
  const defaultTopic = SUPPORT_TOPICS.find((entry) => entry.value === raw)?.value as SupportTopic | undefined;

  return (
    <MarketingPageShell>
      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 pb-10 pt-10 text-center sm:px-6 sm:pt-14 lg:px-12">
        <FadeIn>
          <span className="rounded-full border border-hairline px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Get help
          </span>
        </FadeIn>
        <FadeIn delay={0.08}>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Something in the way? Tell us.
          </h1>
        </FadeIn>
        <FadeIn delay={0.16}>
          <p className="max-w-xl text-base leading-relaxed text-foreground-muted">
            KIVO signs you in with a code sent to your email — no password to reset. That works until the email
            doesn&apos;t show up, and then you need a person, not a form letter. This reaches one.
          </p>
        </FadeIn>
      </section>

      <section className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 px-4 pb-16 sm:px-6 lg:px-12 lg:pb-24">
        <FadeIn delay={0.2} className="w-full max-w-xl">
          {/* Above the form deliberately: two of the three most common reasons
              somebody lands here need no human at all, and asking them to write
              out a paragraph first would waste their time and ours. */}
          <div className="rounded-3xl border border-hairline bg-surface-inset p-5 text-sm leading-relaxed text-foreground-muted">
            <h2 className="pb-2 text-sm font-semibold text-foreground">Two things worth trying first</h2>
            <ul className="flex list-disc flex-col gap-2 pl-4">
              <li>
                Check your spam or promotions folder for a message from KIVO, and search for the words{" "}
                <span className="text-foreground">sign in to KIVO</span>. Every KIVO sign-in email also contains a
                link — tapping that link signs you in even if the six-digit code never made it through.
              </li>
              <li>
                If you&apos;ve never signed up on this address,{" "}
                <Link href="/sign-up" className="font-medium text-accent transition-colors hover:text-foreground">
                  create an account
                </Link>{" "}
                instead — sign-in only sends a code to addresses that already have one.
              </li>
            </ul>
          </div>
        </FadeIn>

        <FadeIn delay={0.28} className="flex w-full flex-col items-center">
          <SupportForm defaultTopic={defaultTopic} />
        </FadeIn>
      </section>
    </MarketingPageShell>
  );
}
