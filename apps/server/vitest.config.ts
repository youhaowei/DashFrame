import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const configDir = dirname(fileURLToPath(import.meta.url));

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
