import type { ReactNode } from "react";
import { Info } from "lucide-react";

// Shared callout used on the legal pages (privacy, terms) for anything that
// needs to stand apart from the surrounding policy text: the "this is a
// template, get real legal review" disclaimer, the placeholder contact note,
// etc. Reuses the same kivo-glass-brand surface as the rest of the product
// rather than inventing a one-off "warning" style.
export function LegalNotice({ children }: { children: ReactNode }) {
  return (
    <div className="kivo-glass-brand flex items-start gap-3 rounded-2xl p-5 sm:p-6">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-accent" strokeWidth={1.75} />
      <div className="text-sm leading-relaxed text-foreground-muted sm:text-base">{children}</div>
    </div>
  );
}
