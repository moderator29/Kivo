import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import iconStrokeWeight from "./eslint-rules/icon-stroke-weight.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Git worktrees used by background agents — not part of this tree's source.
    ".claude/**",
  ]),
  // KIVO's own rules. Kept in `eslint-rules/` as plain ESM so the flat config
  // can load them without a build step. See each rule file's header for the
  // KIVO_NEXT_GEN item it closes.
  {
    files: ["src/**/*.tsx"],
    plugins: {
      kivo: {
        rules: {
          "icon-stroke-weight": iconStrokeWeight,
        },
      },
    },
    rules: {
      // KN-71: stroke weight comes from the optical scale in
      // src/lib/design-system.ts, not from whatever a call site reached for.
      "kivo/icon-stroke-weight": "error",
    },
  },
]);

export default eslintConfig;
