import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      // Resolve the credential-ref guard's shape predicate from source so the
      // unit tests do not depend on a built wystack dist (mirrors connector-rest).
      "@wystack/secret-vault": path.resolve(
        __dirname,
        "../../libs/wystack/packages/secret-vault/src/index.ts",
      ),
    },
  },
});
