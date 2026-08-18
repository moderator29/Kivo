import Link from "next/link";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";

// Shared header for the marketing/info pages (about, privacy, terms) that
// aren't the landing page itself. Same visual language as the landing
// page's own header (KivoMarkGlyph + wordmark, sign in / sign up links) but
// pulled into its own component so /about, /privacy and /terms don't each
// hand-roll a copy — and so it never needs touching src/app/page.tsx, which
// keeps its own inline header intentionally (see that file).
export function SiteHeader() {
  return (
    <header className="flex items-center justify-between px-4 py-5 sm:px-6 lg:px-12">
      <Link href="/" className="flex min-h-10 items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <KivoMarkGlyph size={32} />
        <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        {/* min-h-10 (40px) keeps these at a real tap-target size on mobile —
            the px/py alone (matching the landing page's own header buttons)
            renders a couple of px short of the 40px guideline. */}
        <Link
          href="/sign-in"
          className="flex min-h-10 items-center rounded-xl px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:px-4"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime flex min-h-10 items-center rounded-xl px-3 py-2 text-sm font-semibold text-on-accent kivo-glow kivo-raise kivo-focusable sm:px-4"
        >
          Sign up
        </Link>
      </div>
    </header>
  );
}
