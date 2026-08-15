import Link from "next/link";
import { KivoMarkGlyph } from "@/components/ui/kivo-mark-glyph";

// Shared footer for the marketing/info pages, matching the landing page's
// own footer structure and copy (same FOOTER_LINKS shape) without importing
// from src/app/page.tsx, which stays untouched. Keeping this as its own
// component also means /about, /privacy and /terms link to each other and
// back to the product surfaces consistently.
const FOOTER_LINKS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Live scores", href: "/live" },
      { label: "Match Centre", href: "/matches" },
      { label: "Fantasy", href: "/fantasy" },
      { label: "Predictions", href: "/predictions" },
      { label: "AI Copilot", href: "/ai" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/5 px-4 py-12 sm:px-6 lg:px-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          <div className="flex max-w-xs flex-col gap-3">
            <Link href="/" className="flex items-center gap-2">
              <KivoMarkGlyph size={28} />
              <span className="text-base font-semibold tracking-tight text-foreground">KIVO</span>
            </Link>
            <p className="text-sm text-foreground-subtle">
              Football. Together. Live. Built for football lovers, starting in Nigeria.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:flex sm:gap-16">
            {FOOTER_LINKS.map((group) => (
              <div key={group.heading} className="flex flex-col gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">
                  {group.heading}
                </span>
                <ul className="flex flex-col gap-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-sm text-foreground-muted transition-colors hover:text-foreground"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-white/5 pt-6 text-xs text-foreground-subtle sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} KIVO</span>
          <span>Real football data, real fans, no fabricated stats. Ever.</span>
        </div>
      </div>
    </footer>
  );
}
