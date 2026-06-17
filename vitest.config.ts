import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Honour the `@/*` path aliases from tsconfig so modules resolve in tests.
    tsconfigPaths: true,
    alias: {
      // `server-only` is a build-time marker (Next provides it via the
      // react-server condition). In the node test environment it has no real
      // module, so stub it to a no-op. See test/stubs/server-only.ts.
      "server-only": new URL("./test/stubs/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["modules/**/*.test.ts", "lib/**/*.test.ts", "app/**/*.test.ts"],
  },
});
