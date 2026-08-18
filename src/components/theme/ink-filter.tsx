/**
 * SVG filter that strips the brand lockup's bloom halo, for light mode.
 *
 * `kivo-logo-transparent.webp` is not a clean cutout: the entire 1254² square
 * carries a faint blue glow at roughly 4% alpha. Over obsidian that glow is
 * the intended bloom. Over a near-white page it composites to about #f1f1ff,
 * so the asset reads as a tinted rectangle with hard edges around the mark —
 * which no blend mode can fix, because over a white backdrop every separable
 * blend mode collapses to plain source-over.
 *
 * A radial mask is the usual answer and is wrong here: the mark's ink runs
 * right out to the edges of its own bounding box, so any mask soft enough to
 * erase the corners also eats the glyph.
 *
 * What actually separates the two is alpha, not position — 4% versus ~98% —
 * so this remaps the alpha channel instead: everything under a quarter opaque
 * goes to zero, everything over three-quarters stays solid, with a ramp
 * between so the glyph's own antialiased edge is not turned into a staircase.
 *
 * `color-interpolation-filters="sRGB"` matters: SVG filters default to
 * linearRGB, which would shift the mark's colours as a side effect of an
 * operation that is only supposed to touch alpha.
 *
 * Rendered once from the root layout — `filter: url(#…)` resolves against the
 * document, so one definition serves every instance, and duplicating it per
 * component would mean duplicate ids.
 */
export function KivoInkFilter() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
      <defs>
        <filter id="kivo-ink-alpha" colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0 0.45 1 1" />
          </feComponentTransfer>
        </filter>
      </defs>
    </svg>
  );
}
