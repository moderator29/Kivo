/**
 * Per-field markers for values preview mode has faked (see
 * src/lib/preview-mode.ts). The page-level PreviewModeBanner covers the
 * whole-page case, but a screenshot or crop of just one card must still be
 * unmistakable as fake on its own — hence a marker on the field itself, not
 * only the page.
 *
 * `PREVIEW_FIELD_CLASSNAME` gives the containing card a dashed amber border
 * instead of its normal solid one; `PreviewAsterisk` adds an inline glyph
 * with a native tooltip explaining it. Use both together on any element
 * showing a value that only exists because preview mode is on.
 */
export const PREVIEW_FIELD_CLASSNAME = "border border-dashed border-amber-400/70 bg-amber-400/[0.06]";

export function PreviewAsterisk() {
  return (
    <sup
      className="ml-0.5 cursor-help text-[11px] font-bold not-italic text-amber-400"
      title="Preview mode: sample value for design review, not real data"
    >
      *
      <span className="sr-only"> (sample value shown by preview mode — not real data)</span>
    </sup>
  );
}
