import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Tests import main.ts which touches Electron at import time — give each
    // test file its own module registry so vi.mock factories run cleanly.
    isolate: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    // Workspace packages export a "bun" condition pointing at TS source.
    // Vitest uses Vite's resolver which doesn't recognise "bun", so alias each
    // dep to its src entry so resolution succeeds. All of these deps are fully
    // mocked in the test file, so the aliased files are never actually executed.
    alias: {
      "@dashframe/engine-server": path.resolve(
        configDir,
        "../../packages/engine-server/src/index.ts",
      ),
      "@dashframe/server-core": path.resolve(
        configDir,
        "../../packages/server-core/src/index.ts",
      ),
      "@dashframe/server/app": path.resolve(
        configDir,
        "../../apps/server/src/app.ts",
      ),
    },
  },
});
