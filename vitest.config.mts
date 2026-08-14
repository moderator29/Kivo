import { defineConfig } from "vitest/config";

// Pure-function unit tests only for now (no React component tests yet), so a
// plain "node" environment is enough — no jsdom / @testing-library/react
// dependency is pulled in until a component test actually needs it.
// resolve.tsconfigPaths lets tests import via the "@/*" alias declared in
// tsconfig.json, same as the app code.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
