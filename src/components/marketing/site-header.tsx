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
      <Link href="/" className="flex items-center gap-2">
        <KivoMarkGlyph size={32} />
        <span className="text-lg font-semibold tracking-tight text-foreground">KIVO</span>
      </Link>
      <div className="flex items-center gap-2 sm:gap-3">
        <Link
          href="/sign-in"
          className="rounded-xl px-3 py-2 text-sm font-medium text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 sm:px-4"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="kivo-gradient-prime rounded-xl px-3 py-2 text-sm font-semibold text-kivo-white shadow-[0_0_0_1px_rgba(0,217,255,0.4)] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kivo-cyan/60 sm:px-4"
        >
          Sign up
        </Link>
      </div>
    </header>
  );
}
