import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    // PGLite cold-start can exceed Vitest's default timeouts in CI. The
    // command-vocabulary suite opens a fresh artifact DB per test in a
    // `beforeEach`, so the HOOK timeout (default 10s) needs raising too — not
    // just testTimeout, which doesn't cover hooks.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@dashframe/server-core": path.resolve(
        configDir,
        "../../packages/server-core/src",
      ),
      "@wystack/db": path.resolve(
        configDir,
        "../../libs/wystack/packages/db/src",
      ),
      "@wystack/server": path.resolve(
        configDir,
        "../../libs/wystack/packages/server/src",
      ),
      "@wystack/transport": path.resolve(
        configDir,
        "../../libs/wystack/packages/transport/src",
      ),
    },
  },
});
