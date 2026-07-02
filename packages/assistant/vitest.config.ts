import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

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
      // ESM-safe base (this package is type:module; no __dirname at runtime).
      "@wystack/secret-vault": resolve(
        configDir,
        "../../libs/wystack/packages/secret-vault/src/index.ts",
      ),
    },
    // Vite/Vitest's resolver does not consult a package's own "bun" export
    // condition — it falls through to "import"/"default". This package is
    // TS-only (no dist), so without this, `import("@dashframe/assistant")`
    // in src/index.test.ts (the pi-dependency smoke test) fails to resolve.
    // Adding "bun" here makes Vitest resolve the self-import via source,
    // matching how the bun runtime and the Electron esbuild bundle
    // (conditions: ["bun"]) already resolve this package in production.
    conditions: ["bun"],
  },
});
