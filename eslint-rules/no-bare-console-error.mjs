/**
 * KIVO lint rule: failures go through `logError`, not `console.error`.
 *
 * KN-129. `docs/STRUCTURAL_SURVEY.md` measured 112 `console.error` calls
 * against 5 `logError` and named it a top-five item; by the time this rule was
 * written the ratio was 135 to 47, because every new pass reaches for
 * `console.error` — it is what fingers type. The mechanical conversion is the
 * easy half and does not stay done: without a rule, the next pass reintroduces
 * the split, and a structured sink that only some failures reach is worse than
 * none, because a log search that returns nothing looks like "no errors".
 *
 * `src/lib/log.ts` is exempt: it *is* the sink, and its own `console.error` is
 * the transport. Test files are exempt too — a test asserting on console
 * output is testing the sink, not bypassing it.
 *
 * Not auto-fixable on purpose. The fix needs a context tag chosen by someone
 * who knows what the call site does; a rule that invented one would fill the
 * logs with tags nobody can search for, which is the exact failure this is
 * meant to prevent.
 */

const ALLOWED = [
  // The sink itself.
  /src\/lib\/log\.ts$/,
  // Tests.
  /\.test\.tsx?$/,
  /\.integration\.test\.tsx?$/,
];

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Report failures through logError() so they have a searchable, structured shape.",
    },
    schema: [],
    messages: {
      bare:
        "Use logError(context, error, metadata) from @/lib/log instead of console.{{method}}. " +
        "A bare console call has no context tag, so it cannot be found in a log search — " +
        "pick a tag like \"football.sync.startRun\" that names where this happened.",
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (ALLOWED.some((pattern) => pattern.test(filename))) return {};

    return {
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || node.object.name !== "console") return;
        if (node.property.type !== "Identifier") return;
        if (node.property.name !== "error") return;
        context.report({ node, messageId: "bare", data: { method: node.property.name } });
      },
    };
  },
};

export default rule;
