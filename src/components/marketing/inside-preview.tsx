import { ArrowRight, MessagesSquare, Radio, Shield } from "lucide-react";

/**
 * "A look inside" for the landing page (KN-38).
 *
 * The problem this exists for: KIVO is fully gated, so a visitor cannot sample
 * anything. A marketing page that describes Match Rooms, live scores and a
 * Copilot, and then links to all three behind a login wall, makes the gate feel
 * like a bug. The item's answer is to *show* rather than link.
 *
 * What it shows, and — more importantly — what it refuses to show. Every
 * fixture, score, club name and Room count in the real product comes from
 * verified synced data, and this page has none of that available to it. So this
 * renders KIVO's actual interface — the same brand-glass lead card, the same
 * chip, the same stacked scoreboard, the same two actions — with its *content
 * slots labelled* rather than filled with invented football. There is no
 * plausible-looking scoreline here, no made-up club, no fabricated "8 people in
 * the Room", because a marketing screenshot of data that does not exist is
 * still fabricated data. The caption says plainly which half is which.
 *
 * Static and server-rendered: this is the highest-traffic, most
 * bounce-sensitive route in the product and it does not get a JS bundle for a
 * decorative panel (same reasoning as the landing page's CSS-only floats).
 */

function SlotLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-foreground-subtle">{children}</span>;
}

export function InsidePreview() {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="w-full max-w-sm rounded-[28px] border border-hairline bg-background p-3 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.55)]">
        <div className="flex flex-col gap-3 rounded-[20px] bg-surface-1 p-4">
          <div className="flex flex-col gap-1">
            <SlotLabel>Good evening</SlotLabel>
            <span className="text-base font-semibold text-foreground">Your football, first.</span>
          </div>

          {/* The real lead card's chrome, with its content slots named instead
              of filled — see this file's doc comment. */}
          <div className="kivo-glass-brand relative overflow-hidden rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-live/40 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-live">
                <Radio className="h-3 w-3" strokeWidth={2} />
                Live now
              </span>
              <span className="text-xs text-foreground-subtle">Because you follow them</span>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {["Your club", "Their opponent"].map((slot) => (
                <div key={slot} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
                    <Shield className="h-4 w-4 text-foreground-subtle" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-foreground-muted">{slot}</span>
                  <span className="h-4 w-5 rounded bg-surface-3" aria-hidden="true" />
                </div>
              ))}
            </div>

            {/* Stacked at every width: the frame is phone-width by design, so
                the real card's `sm:flex-row` would wrap both labels onto two
                lines inside it. */}
            <div className="mt-4 flex flex-col gap-2">
              <span className="kivo-gradient-prime inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-on-accent">
                Open Match Centre
                <ArrowRight className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <span className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-hairline bg-surface-1 px-4 py-2.5 text-sm font-medium text-foreground">
                Join the Room
              </span>
            </div>
          </div>

          <div className="kivo-glass flex items-center justify-between rounded-2xl p-4">
            <div className="flex flex-col gap-1">
              <SlotLabel>Today across KIVO</SlotLabel>
              <span className="text-sm text-foreground-muted">Every fixture KIVO has verified</span>
            </div>
            <MessagesSquare className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.75} />
          </div>
        </div>
      </div>

      <p className="max-w-sm text-center text-xs leading-relaxed text-foreground-subtle">
        That&apos;s the real layout, with the content slots labelled rather than filled. KIVO doesn&apos;t print example
        scorelines or invented clubs, here or anywhere — what goes in those slots is your own football, from data
        it has actually verified.
      </p>
    </div>
  );
}
