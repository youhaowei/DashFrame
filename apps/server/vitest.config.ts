import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    // PGLite cold-start can exceed Vitest's default 5s timeout in CI.
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@dashframe/server-core": path.resolve(
        __dirname,
        "../../packages/server-core/src",
      ),
      "@wystack/db": path.resolve(
        __dirname,
        "../../libs/wystack/packages/db/src",
      ),
      "@wystack/server": path.resolve(
        __dirname,
        "../../libs/wystack/packages/server/src",
      ),
      "@wystack/transport": path.resolve(
        __dirname,
        "../../libs/wystack/packages/transport/src",
      ),
    },
  },
});
