import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pure-function unit tests only for now (no React component tests yet), so a
// plain "node" environment is enough — no jsdom / @testing-library/react
// dependency is pulled in until a component test actually needs it.
// resolve.tsconfigPaths lets tests import via the "@/*" alias declared in
// tsconfig.json, same as the app code.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // KN-130: server actions and most of src/lib open with `import
      // "server-only"`, whose entire job is to fail a *bundle* that pulls
      // server code into the client. Vitest is neither a bundle nor a client,
      // so the guard can only ever throw here — which is what kept every
      // "use server" file untestable. Stubbed, not removed: the guard stays
      // real everywhere it means something.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
