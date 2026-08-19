/**
 * Reading a page's container out of its source, so a skeleton and the page it
 * stands in for can be checked against each other.
 *
 * A skeleton is a promise about where things will land. The promise is kept or
 * broken by one thing above all others: the container. Get the max-width, the
 * padding or the stack gap wrong and every block on the page moves the instant
 * real content arrives — which is worse than showing nothing, because nothing
 * at least makes no promise. Three routes were doing exactly that (`/settings`,
 * `/social`, `/u/<handle>`: `.kivo-page` in the page, the older ad-hoc column
 * in the skeleton, an 8px drop and a tighter stack on arrival) and nothing in
 * the build could see it.
 *
 * These are text functions, not a parser — deliberately. The alternative is
 * either a TypeScript AST walk for a comparison of two class strings, or
 * measuring both in a real browser, which needs a signed-in session and data
 * that a test cannot have. Reading the class attribute is enough to catch the
 * whole class of defect, and `src/lib/page-container.test.ts` proves the
 * reader itself is right before trusting it to police anything.
 */

/** The class names that actually decide where content sits. Everything else —
 * colours, borders, text alignment, hover states — can differ freely between a
 * skeleton and its page without moving anything. */
const LAYOUT_PREFIXES = ["kivo-page", "max-w-", "gap-", "px-", "py-", "p-", "pt-", "pb-"];

function isLayoutToken(token: string): boolean {
  const bare = token.includes(":") ? token.slice(token.indexOf(":") + 1) : token;
  return LAYOUT_PREFIXES.some((prefix) =>
    prefix.endsWith("-") ? bare.startsWith(prefix) : bare === prefix || bare.startsWith(`${prefix}--`),
  );
}

/**
 * Reduces one class string to the tokens that place content, in a stable
 * order, so two containers written with their classes in different orders
 * still compare equal.
 */
export function containerSignature(className: string): string {
  const tokens = className.split(/\s+/).filter(Boolean).filter(isLayoutToken);
  return [...new Set(tokens)].sort().join(" ");
}

/**
 * True for a class string that is a *page container* rather than a card, a
 * row or a badge: it either uses the shared `.kivo-page` container or centres
 * itself with `mx-auto` and a width cap.
 */
export function isPageContainer(className: string): boolean {
  const tokens = className.split(/\s+/);
  return tokens.includes("kivo-page") || (tokens.includes("mx-auto") && tokens.some((t) => t.startsWith("max-w-")));
}

/**
 * Every page-container signature a source file renders.
 *
 * More than one is normal and correct: a page commonly has an early return for
 * a signed-out visitor, or an empty state, in its own container. The rule a
 * skeleton has to satisfy is that its container is one the page *can* render,
 * not that the page has exactly one.
 */
export function pageContainerSignatures(source: string): string[] {
  const signatures = new Set<string>();
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    const className = match[1];
    if (isPageContainer(className)) signatures.add(containerSignature(className));
  }
  // `className={cn("…", …)}` — only the leading literal matters, since that is
  // where a container is written; conditional extras never introduce one.
  for (const match of source.matchAll(/className=\{cn\(\s*"([^"]*)"/g)) {
    const className = match[1];
    if (isPageContainer(className)) signatures.add(containerSignature(className));
  }
  return [...signatures];
}

/**
 * The local component modules a page imports.
 *
 * A page very often does not own its container: `/teams` delegates to
 * `EntityListPage`, `/settings/*` to `SettingsPageShell`, `/ai` to `AiChat`,
 * `/fantasy` to `FantasyBuilder`. Rather than keep a registry of which
 * components are shells — a list that would rot the first time somebody added
 * one — this returns every KIVO-local module the file imports and lets the
 * caller union their containers in. Being over-broad is the safe direction
 * here: an extra allowed container can only make the check quieter, never make
 * it accuse a file wrongly, and in practice almost nothing in this codebase
 * renders a page container except the thing that is one.
 *
 * `@/…` paths come back as-is; relative paths come back relative, for the
 * caller to resolve against the importing file.
 */
export function importedLocalModules(source: string): string[] {
  const paths: string[] = [];
  for (const match of source.matchAll(/from\s*"((?:@\/|\.{1,2}\/)[^"]+)"/g)) {
    paths.push(match[1]);
  }
  return [...new Set(paths)];
}
