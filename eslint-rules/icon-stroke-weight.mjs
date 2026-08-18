/**
 * KIVO lint rule: icon stroke weight must come from the optical scale.
 *
 * KN-71 / RECOMMENDATIONS item 278. `strokeWidth` had spread across six
 * values (1.5, 1.75, 2, 2.25, 2.5, 3) with no rule, and every pass since the
 * item was written added more icons. The scale itself, and the reasoning for
 * it, live in `src/lib/design-system.ts`; this rule is what stops the
 * convention from being aspirational.
 *
 * What it checks, on any JSX element that is a lucide icon (imported from
 * `lucide-react`, or a `something.icon` / `something.Icon` member expression,
 * which is how the nav/feature registries render theirs):
 *   - an explicit `strokeWidth` is present, so nothing silently inherits
 *     lucide's own default of 2 at a size where 2 is wrong;
 *   - its value matches the scale for the size the icon is drawn at, read
 *     from the `h-*` class in `className`.
 *
 * Both are auto-fixable, because the fix is always the same single number.
 *
 * `<Icon>` (src/components/ui/icon.tsx) is exempt by construction — it takes
 * a size, not a weight, and derives the weight itself.
 *
 * The scale is duplicated here rather than imported because ESLint config is
 * plain JS and `design-system.ts` is TypeScript. `src/lib/design-system.test.ts`
 * asserts the two agree, so the duplication cannot drift silently.
 */

/** Mirrors ICON_STROKE_SCALE in src/lib/design-system.ts. */
export const SCALE = [
  { maxSize: 14, strokeWidth: 2 },
  { maxSize: 28, strokeWidth: 1.75 },
  { maxSize: Infinity, strokeWidth: 1.5 },
];

/** lucide-react renders at 24px when no size is given. */
const LUCIDE_DEFAULT_SIZE = 24;

export function expectedStrokeWidth(size) {
  return SCALE.find((step) => size <= step.maxSize).strokeWidth;
}

/**
 * Resolves the rendered pixel height from a Tailwind class string.
 * `h-4` → 16 (Tailwind's 0.25rem step), `h-3.5` → 14, `h-[18px]` → 18.
 * Returns null when the class list doesn't set a height at all.
 */
export function sizeFromClassName(className) {
  if (typeof className !== "string") return null;
  const arbitrary = className.match(/(?:^|\s)h-\[(\d+(?:\.\d+)?)px\]/);
  if (arbitrary) return Number(arbitrary[1]);
  const step = className.match(/(?:^|\s)h-(\d+(?:\.\d+)?)(?:\s|$)/);
  if (step) return Number(step[1]) * 4;
  return null;
}

function attributeNamed(node, name) {
  return node.attributes.find(
    (attribute) => attribute.type === "JSXAttribute" && attribute.name?.name === name,
  );
}

/**
 * Resolves the size this icon is drawn at, or `null` when that cannot be known
 * statically.
 *
 * A `className` built by `cn(...)` or a template literal is deliberately NOT
 * guessed at: assuming lucide's 24px default for a class list that might say
 * `h-3` would make this rule "fix" a small icon to a stroke that is visibly
 * too light. An unverifiable call site is skipped and stays the author's
 * judgement — the rule only speaks where it can actually be right.
 */
function resolvedSize(node) {
  const attribute = attributeNamed(node, "className");
  // No className at all: lucide renders at its own 24px default.
  if (!attribute) return LUCIDE_DEFAULT_SIZE;
  if (attribute.value?.type !== "Literal") return null;
  return sizeFromClassName(attribute.value.value) ?? LUCIDE_DEFAULT_SIZE;
}

const rule = {
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Icon stroke weight must come from KIVO's optical scale (src/lib/design-system.ts).",
    },
    schema: [],
    messages: {
      missing:
        "This icon has no strokeWidth, so it inherits lucide's default of 2. At {{size}}px KIVO's scale is {{expected}} — pass strokeWidth={{'{'}}{{expected}}{{'}'}}, or use <Icon> from @/components/ui/icon.",
      mismatch:
        "strokeWidth {{actual}} is off KIVO's optical scale: at {{size}}px the weight is {{expected}}. See src/lib/design-system.ts, or use <Icon> from @/components/ui/icon.",
    },
  },

  create(context) {
    /** Local names bound to a lucide-react value import in this file. */
    const lucideNames = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== "lucide-react") return;
        // `import type { LucideIcon }` binds a type, never a rendered element.
        if (node.importKind === "type") return;
        for (const specifier of node.specifiers) {
          if (specifier.importKind === "type") continue;
          lucideNames.add(specifier.local.name);
        }
      },

      JSXOpeningElement(node) {
        const name = node.name;
        let isIcon = false;
        if (name.type === "JSXIdentifier") {
          isIcon = lucideNames.has(name.name);
        } else if (name.type === "JSXMemberExpression" && name.property.type === "JSXIdentifier") {
          // `<item.icon />` / `<option.Icon />` — the registry-driven call sites.
          isIcon = name.property.name === "icon" || name.property.name === "Icon";
        }
        if (!isIcon) return;

        const size = resolvedSize(node);
        if (size === null) return;
        const expected = expectedStrokeWidth(size);
        const attribute = attributeNamed(node, "strokeWidth");

        if (!attribute) {
          context.report({
            node,
            messageId: "missing",
            data: { size: String(size), expected: String(expected) },
            fix: (fixer) => fixer.insertTextAfter(node.name, ` strokeWidth={${expected}}`),
          });
          return;
        }

        const value = attribute.value;
        if (value?.type !== "JSXExpressionContainer") return;
        const expression = value.expression;
        if (expression.type !== "Literal" || typeof expression.value !== "number") return;
        if (expression.value === expected) return;

        context.report({
          node: attribute,
          messageId: "mismatch",
          data: { actual: String(expression.value), size: String(size), expected: String(expected) },
          fix: (fixer) => fixer.replaceText(expression, String(expected)),
        });
      },
    };
  },
};

export default rule;
