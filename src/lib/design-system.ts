/**
 * KIVO's design system, as data.
 *
 * KIVO_NEXT_GEN.md KN-63: `globals.css` defines three glass tiers, five brand
 * gradients, two distinct motion vocabularies and a reward signature — and
 * until this file the *rules* for choosing between them lived only as prose in
 * `RECOMMENDATIONS.md` items 318–320. Prose in a 300-item backlog is not a
 * design system; it is a document nobody opens while writing a component.
 *
 * This module is the single machine-readable source of truth for those rules.
 * `/admin/design` renders it against the live stylesheet, so the *resolved*
 * value of every token in the current theme is visible next to the rule that
 * governs it. That turns items 319/320's "audit the call sites" from a
 * memory exercise into a side-by-side comparison, and it means a token that
 * silently loses its definition (or drifts between themes) shows up as an
 * empty swatch on a page an admin actually looks at, rather than as a
 * component that renders slightly wrong three routes away.
 *
 * Deliberately data, not JSX: a lint rule, a test, or a future contrast
 * checker can import these lists. Nothing here fabricates a value — every
 * entry names a custom property or class that really exists in
 * `src/app/globals.css`, and `/admin/design` reads the value off the DOM
 * rather than repeating it here, so this file cannot drift into claiming a
 * colour the stylesheet doesn't actually produce.
 */

export type TokenSpec = {
  /** The CSS custom property, exactly as declared in globals.css. */
  varName: string;
  /** The Tailwind utility that consumes it, when there is one. */
  utility?: string;
  /** When to reach for this rather than its neighbours. */
  rule: string;
};

export type TokenGroup = {
  id: string;
  title: string;
  /** Why this group exists as a group — the axis it varies along. */
  intent: string;
  tokens: TokenSpec[];
};

export const TOKEN_GROUPS: TokenGroup[] = [
  {
    id: "canvas",
    title: "Canvas",
    intent:
      "The page itself. Nothing in a component should set these — they are what a component sits on, and the theme swaps them underneath.",
    tokens: [
      { varName: "--background", utility: "bg-background", rule: "The page. One per document." },
      {
        varName: "--background-secondary",
        utility: "bg-background-secondary",
        rule: "A full-bleed band that needs to separate from the page without becoming a card.",
      },
      {
        varName: "--surface",
        utility: "bg-surface",
        rule: "Opaque panel fill where translucency would hurt legibility over dense data.",
      },
    ],
  },
  {
    id: "surfaces",
    title: "Surfaces",
    intent:
      "A depth ladder, not a palette. Pick by how far the element should read as raised off the page, never by which shade looks nicer.",
    tokens: [
      { varName: "--surface-1", utility: "bg-surface-1", rule: "Resting container. The default for a card fill." },
      { varName: "--surface-2", utility: "bg-surface-2", rule: "One step up: hover, selected row, a nested card." },
      {
        varName: "--surface-3",
        utility: "bg-surface-3",
        rule: "Opaque chrome — sidebar, popover body, sheet. Never translucent, because menus sit over content.",
      },
      {
        varName: "--surface-track",
        utility: "bg-surface-track",
        rule: "Recessed rail behind a segmented control or progress bar.",
      },
      { varName: "--surface-raised", utility: "bg-surface-raised", rule: "The lifted thumb inside a track." },
      { varName: "--surface-inset", utility: "bg-surface-inset", rule: "A field the user types into." },
    ],
  },
  {
    id: "lines",
    title: "Hairlines",
    intent:
      "Weight signals importance of the boundary, not decoration. Three steps only — a fourth would stop being distinguishable.",
    tokens: [
      { varName: "--hairline-soft", utility: "border-hairline-soft", rule: "Divider inside one container." },
      { varName: "--hairline", utility: "border-hairline", rule: "The default container edge." },
      {
        varName: "--hairline-strong",
        utility: "border-hairline-strong",
        rule: "An edge that must survive over a busy background, or an emphasised control.",
      },
    ],
  },
  {
    id: "text",
    title: "Text",
    intent:
      "Three levels, and they are a hierarchy, not three greys. If a screen needs a fourth, the screen has too much on it.",
    tokens: [
      { varName: "--foreground", utility: "text-foreground", rule: "Content. Names, scores, headings, body." },
      {
        varName: "--foreground-muted",
        utility: "text-foreground-muted",
        rule: "Supporting copy that is still meant to be read.",
      },
      {
        varName: "--foreground-subtle",
        utility: "text-foreground-subtle",
        rule: "Labels and metadata. Never the only place a fact appears.",
      },
    ],
  },
  {
    id: "accent",
    title: "Accent",
    intent:
      "KIVO's one energy colour. Reserved for the live thing, the selected thing, and the primary action — not for emphasis in general.",
    tokens: [
      { varName: "--accent", utility: "text-accent", rule: "Active state, focus, the one primary action on screen." },
      { varName: "--accent-strong", utility: "bg-accent-strong", rule: "A filled accent surface that carries label text." },
      { varName: "--accent-soft", utility: "bg-accent-soft", rule: "A tinted wash behind an accented row or chip." },
      { varName: "--accent-hairline", rule: "The bright border on `.kivo-glass-sharp`." },
      { varName: "--on-accent", utility: "text-on-accent", rule: "Text on an accent fill. Never guess this per call site." },
      { varName: "--ring", rule: "The one focus ring in the app, via `.kivo-focus`." },
    ],
  },
  {
    id: "status",
    title: "Status",
    intent:
      "Meaning, not mood. Each of these makes a factual claim about state, so none of them may be used decoratively.",
    tokens: [
      { varName: "--kivo-live", utility: "text-live", rule: "A match is genuinely in play right now." },
      { varName: "--kivo-critical", utility: "text-critical", rule: "A real failure or a destructive action." },
      { varName: "--kivo-warning", utility: "text-warning", rule: "Degraded or stale, but working." },
      { varName: "--kivo-info", utility: "text-info", rule: "Neutral context the user did not ask for." },
      {
        varName: "--kivo-achievement",
        utility: "text-achievement",
        rule: "Something the user actually earned. Pairs with the reward motion signature below.",
      },
    ],
  },
  {
    id: "elevation",
    title: "Elevation",
    intent:
      "How far off the page. Shadow strength must track how much of the page the element is allowed to interrupt.",
    tokens: [
      { varName: "--shadow-soft", utility: "shadow-soft", rule: "Resting card. Barely there in dark, real in light." },
      { varName: "--shadow-raise", utility: "shadow-raise", rule: "Hover / lifted." },
      { varName: "--shadow-pop", utility: "shadow-pop", rule: "Popover, menu, command palette." },
      { varName: "--shadow-float", utility: "shadow-float", rule: "Modal or sheet — the only thing the user can act on." },
      { varName: "--overlay", utility: "bg-overlay", rule: "The scrim under a modal or sheet." },
    ],
  },
];

export type SurfaceTier = {
  className: string;
  title: string;
  /** The one-line rule for reaching for this tier over its neighbours. */
  rule: string;
  /** Where it is genuinely correct today. */
  examples: string;
};

/**
 * The depth hierarchy, per RECOMMENDATIONS.md item 319. The rule the item
 * argues for — strongest tier reserved for genuinely elevated moments, plain
 * glass as the default for routine information — is stated here once so a
 * component author can check a choice in ten seconds.
 */
export const SURFACE_TIERS: SurfaceTier[] = [
  {
    className: "kivo-glass",
    title: "Glass — the default",
    rule: "Every routine informational container. If you are unsure which tier a card wants, it wants this one.",
    examples: "Fixture rows, stat panels, settings groups, the sidebar's nav card.",
  },
  {
    className: "kivo-glass kivo-glass-interactive",
    title: "Glass, interactive",
    rule: "Add only when the whole glass surface is itself the click target. It exists so a static panel never signals clickability it does not have.",
    examples: "A card that is a link in its entirety.",
  },
  {
    className: "kivo-glass-sharp",
    title: "Sharp — controls",
    rule: "Buttons and controls that need to read as pressable without a filled accent background.",
    examples: "Secondary buttons, filter chips, the composer's actions.",
  },
  {
    className: "kivo-glass-brand",
    title: "Brand ring — elevated moments only",
    rule: "Reserved. A live match, the viewer's own row in a leaderboard, a correct prediction, rank #1. Never a routine feature list — item 319 found exactly that inversion on the landing page, where the load-bearing trust claims got plain glass and a feature grid got the ring.",
    examples: "The Match Centre score header while a match is live.",
  },
  {
    className: "kivo-popover",
    title: "Popover — floating chrome",
    rule: "Anything that floats over content and must stay readable: menus, sheets, the command palette. Opaque in both themes by design.",
    examples: "Account menu, reaction picker, mobile More sheet.",
  },
  {
    className: "kivo-field",
    title: "Field — input",
    rule: "Anything the user types into. Recessed, so it reads as 'type here' rather than as another card.",
    examples: "Search, the post composer, settings inputs.",
  },
];

export type GradientSpec = { className: string; title: string; rule: string };

export const GRADIENTS: GradientSpec[] = [
  { className: "kivo-gradient-prime", title: "Prime", rule: "The primary action, and the active-nav indicator. KIVO's default energy." },
  { className: "kivo-gradient-intelligence", title: "Intelligence", rule: "AI Copilot surfaces only. Violet is the app's signal for 'a model produced this'." },
  { className: "kivo-gradient-pulse", title: "Pulse", rule: "Live and realtime affordances." },
  { className: "kivo-gradient-premium", title: "Premium", rule: "Rare. Reserved for genuinely premium framing, not for general emphasis." },
  {
    className: "kivo-gradient-victory",
    title: "Victory",
    rule: "The achievement ramp. Half of the reward signature below — never used for routine chrome.",
  },
];

export type MotionVocabulary = {
  id: string;
  title: string;
  /** The literal transition values, so a call site can be checked against them. */
  spec: string;
  rule: string;
  usedBy: string;
};

/**
 * The two vocabularies RECOMMENDATIONS.md item 318 measured, plus the reward
 * signature it proposed. Named here so a new component picks one deliberately
 * instead of inventing a third.
 */
export const MOTION_VOCABULARIES: MotionVocabulary[] = [
  {
    id: "content",
    title: "Content entrance",
    spec: "cubic-bezier(0.22, 1, 0.36, 1), 0.35s, opacity + 12px rise. No overshoot.",
    rule: "Content arriving for the first time. Calm, because the content is the point and the motion is only saying 'this is new'.",
    usedBy: "FadeIn, StaggeredList, ScrollReveal, kivo-fade-in.",
  },
  {
    id: "chrome",
    title: "Interactive chrome",
    spec: "spring, stiffness 400–500, damping 32–40.",
    rule: "Something the user just did: a popover opening, a drawer sliding, the active-tab indicator moving. Responds like a physical object because the user's hand caused it.",
    usedBy: "Popovers, sheets, the sidebar's active-route bar, tab indicators.",
  },
  {
    id: "reward",
    title: "Reward signature",
    spec: "spring, stiffness 600, damping 12 — paired always with kivo-gradient-victory.",
    rule: "Reserved. Only for a moment the user genuinely earned against real data: a correct prediction resolving, a badge unlocking, a real goal in a match the user is watching. Never a list entrance, never a page transition. It is the only motion in the app allowed to overshoot visibly, and that is what makes it read as a reward rather than as chrome.",
    usedBy: "Reaction picker (the original), the goal glow in Match Centre.",
  },
];

/**
 * The house icon stroke weight. lucide-react defaults to 2, which sits a
 * visible notch heavier than KIVO's type at the 14–20px sizes the app draws
 * icons at. KN-71 / RECOMMENDATIONS item 278 measured the drift across the
 * codebase; `<Icon>` in src/components/ui/icon.tsx exists so a call site
 * cannot silently pick a different one.
 */
export const ICON_STROKE = 1.75;

/**
 * The optical stroke-weight scale.
 *
 * KN-71 / RECOMMENDATIONS item 278 read the spread of `strokeWidth` values in
 * this codebase as pure drift from a single 1.75 house style. Measuring the
 * weights *against the sizes they are drawn at* tells a different and better
 * story: authors have been compensating optically all along, and correctly —
 * at 12px a 1.75 stroke goes thin and mushy, at 32px it reads as a heavy
 * sketch. Every size in the app already had a clear majority weight, and they
 * form a monotonic ramp.
 *
 * So the fix is not "one weight everywhere" — that is a rendering artefact
 * dressed up as consistency. It is to name the ramp the codebase already
 * voted for, make it automatic via `<Icon>` (src/components/ui/icon.tsx), and
 * lint the strays. The thresholds below were chosen so that the majority of
 * existing call sites at every single size is already correct, which is why
 * adopting this changes the fewest pixels while making the rule real.
 *
 * Sizes are the *rendered* pixel size of the icon box.
 */
export const ICON_STROKE_SCALE: { maxSize: number; strokeWidth: number }[] = [
  // ≤14px — small enough that a lighter stroke loses definition entirely.
  { maxSize: 14, strokeWidth: 2 },
  // 16–28px — the workhorse range. Matches KIVO's type weight.
  { maxSize: 28, strokeWidth: 1.75 },
  // ≥32px — display sizes, where 1.75 starts to read as chunky.
  { maxSize: Infinity, strokeWidth: 1.5 },
];

/** The house weight for the workhorse 16–28px range. */
export function iconStrokeWidth(size: number): number {
  return ICON_STROKE_SCALE.find((step) => size <= step.maxSize)!.strokeWidth;
}

/** Named sizes, so a call site picks from the scale rather than a raw number. */
export const ICON_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  "2xl": 32,
} as const;

export type IconSize = keyof typeof ICON_SIZES;

/* ---------------------------------------------------------------------------
   CONTAINERS, DENSITY AND TYPE

   Added after production feedback that the product reads as "basic", "jam
   packed", and that container styling "is not really slick". Those are three
   descriptions of one thing: KIVO has good tokens and no *rhythm*. Measured
   across the codebase before writing any of this down, because a spacing rule
   invented from taste is just one more opinion:

     container radius   rounded-2xl x200, rounded-3xl x40, rounded-xl x39
     container padding  p-5 x70, p-4 x67, p-6 x52, p-8 x18, p-3 x15
     gaps               gap-3 x361, gap-2 x350, gap-1.5 x171, gap-1 x118
     UI type            text-sm x465, text-xs x422, text-[11px] x212,
                        plus text-[10px] x14 and text-[9px] x3

   Two things stand out. Container padding has four popular values and no rule
   for choosing between them — that is what "not slick" looks like from the
   outside. And 289 uses of gap-1/gap-1.5 against 52 uses of p-6/p-8 means the
   space *between* elements is routinely competing with the space *around*
   them, which is precisely what "jam packed" describes: nothing groups,
   because everything is equally close to everything else.
--------------------------------------------------------------------------- */

export type ContainerRole = {
  id: string;
  title: string;
  /** The Tailwind classes that define this role's box. */
  spec: string;
  rule: string;
};

/**
 * The container ladder. Radius, padding and internal gap move together — a
 * container is not a radius you pick and a padding you pick, it is one of these
 * five things. Values follow the measured majority at each size, so adopting
 * the ladder is mostly a matter of naming what is already there.
 */
export const CONTAINER_ROLES: ContainerRole[] = [
  {
    id: "control",
    title: "Control",
    spec: "rounded-xl · px-3.5 py-2.5 · gap-2",
    rule: "Anything pressable: button, chip, field, tab. Small radius, tight gap — a control is one object, not a group.",
  },
  {
    id: "row",
    title: "Row",
    spec: "px-4 py-3 · gap-3 · no radius of its own",
    rule: "One item among many inside a grouped card. It inherits the card's corners and is separated by a hairline, never by its own box — stacked boxes are what makes a list look cluttered.",
  },
  {
    id: "card",
    title: "Card",
    spec: "rounded-2xl · p-5 · gap-3",
    rule: "The default. One unit of content. If you are unsure what a container is, it is this.",
  },
  {
    id: "panel",
    title: "Panel",
    spec: "rounded-2xl · p-6 · gap-4",
    rule: "A section that contains cards or rows and has its own heading. More padding than a card because it is holding other containers, not text.",
  },
  {
    id: "feature",
    title: "Feature",
    spec: "rounded-3xl · p-6 sm:p-8 · gap-4",
    rule: "Rare, and earns it: a hero, a live match header, a moment the user earned. Pairs with the brand-ring glass tier. More than one on a screen means none of them is a feature.",
  },
];

export type DensityRule = { title: string; rule: string; why: string };

/**
 * The four rules that decide whether a screen breathes. Everything here is a
 * relationship between two numbers, not a number — which is why none of them
 * can be expressed as a token, and why they need saying out loud.
 */
export const DENSITY_RULES: DensityRule[] = [
  {
    title: "Padding beats gap",
    rule: "The padding around a group must be visibly larger than the gap between the things inside it. A p-5 card holds gap-3 children; it never holds gap-5 children.",
    why: "Grouping is carried entirely by this ratio. When they are equal, the eye cannot tell what belongs to what, and the screen reads as jammed no matter how much total space is on it.",
  },
  {
    title: "Corners nest inward",
    rule: "A container inside a container drops one radius step: rounded-2xl outside, rounded-xl inside. Never the same radius twice, never larger inside than out.",
    why: "Concentric corners are the difference between two boxes that were placed and two boxes that happened to overlap. It is a small detail that reads instantly as considered.",
  },
  {
    title: "One divider weight per boundary",
    rule: "Inside a container, separate rows with border-hairline-soft. The container's own edge is border-hairline. Do not stack a card inside a card to separate two rows.",
    why: "Nested boxes multiply edges. A grouped list with one outer edge and hairline dividers holds the same content in visibly less visual noise.",
  },
  {
    title: "Vertical rhythm is coarse, not fine",
    rule: "Between top-level sections of a page: gap-6. Inside a section: gap-3. Nothing in between.",
    why: "Two clearly different spacings read as structure. Five slightly different spacings read as an accident, which is the single most common reason a competent screen still feels amateur.",
  },
];

export type TypeStep = { className: string; title: string; rule: string };

/**
 * Four steps for UI text and three for headings. The measured tail below the
 * scale — `text-[10px]` and `text-[9px]` — is not a style, it is text nobody
 * over forty can read on a phone, and it should be treated as a defect.
 */
export const TYPE_STEPS: TypeStep[] = [
  { className: "text-2xl font-semibold tracking-tight", title: "Page title", rule: "One per page. Names the screen." },
  { className: "text-lg font-semibold tracking-tight", title: "Section title", rule: "The heading of a panel." },
  { className: "text-sm text-foreground", title: "Body", rule: "Content. Names, copy, values. The default." },
  { className: "text-sm text-foreground-muted", title: "Supporting", rule: "Secondary copy that is still meant to be read." },
  { className: "text-xs text-foreground-subtle", title: "Meta", rule: "Timestamps, counts, captions." },
  {
    className: "text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle",
    title: "Label",
    rule: "The ONLY sanctioned use of 11px, and only uppercase — caps height buys back the legibility the size costs. Never for sentence-case copy, and never smaller than this.",
  },
];
